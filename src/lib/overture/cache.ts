import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";

import {
  arrayBufferToHex,
  isOvertureCacheMetadata,
  isSearchIndex,
  overtureMetadataMatchesManifest,
  versionedOvertureArtifactParts,
  type CachedOvertureSearchArtifact,
  type OvertureCacheMetadata,
  type OvertureSearchManifest,
} from "./cache-contract";
import type { OvertureSearchRecord } from "./search";

const CACHE_METADATA_KEY = "@advisoret/overture/search-artifact";
const CACHE_DIRECTORY_NAME = "advisoret";
const OVERTURE_DIRECTORY_NAME = "overture";

export async function ensureOvertureSearchArtifact(
  manifest: OvertureSearchManifest,
  downloadUrl: string,
): Promise<CachedOvertureSearchArtifact | null> {
  let temporaryFile: File | null = null;

  try {
    const finalFile = await getFinalFile(manifest, true);
    if (!finalFile) return null;

    const cached = await readCachedOvertureSearchArtifact();
    if (
      cached
      && cached.local_uri === finalFile.uri
      && overtureMetadataMatchesManifest(cached.metadata, manifest)
    ) return cached;

    if (await validateFile(finalFile, manifest)) {
      const metadata = metadataFromManifest(manifest, finalFile.uri);
      await AsyncStorage.setItem(CACHE_METADATA_KEY, JSON.stringify(metadata));
      return { metadata, local_uri: finalFile.uri };
    }

    if (finalFile.exists) await finalFile.delete();

    temporaryFile = new File(
      finalFile.parentDirectory,
      `${finalFile.name}.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
    );
    await File.downloadFileAsync(downloadUrl, temporaryFile);
    const validation = await validateFile(temporaryFile, manifest);
    if (!validation) return null;

    if (finalFile.exists) {
      if (await validateFile(finalFile, manifest)) {
        const metadata = metadataFromManifest(manifest, finalFile.uri);
        await AsyncStorage.setItem(CACHE_METADATA_KEY, JSON.stringify(metadata));
        return { metadata, local_uri: finalFile.uri };
      }
      await finalFile.delete();
    }

    await temporaryFile.move(finalFile);
    const metadata = metadataFromManifest(manifest, finalFile.uri);
    await AsyncStorage.setItem(CACHE_METADATA_KEY, JSON.stringify(metadata));
    return { metadata, local_uri: finalFile.uri };
  } catch {
    return null;
  } finally {
    try {
      if (temporaryFile?.exists) {
        await temporaryFile.delete();
      }
    } catch {
      // A failed cleanup must not make a valid cache operation fail.
    }
  }
}

export async function getCachedOvertureSearchArtifact(): Promise<CachedOvertureSearchArtifact | null> {
  try {
    return await readCachedOvertureSearchArtifact();
  } catch {
    return null;
  }
}

async function readCachedOvertureSearchArtifact(): Promise<CachedOvertureSearchArtifact | null> {
  const serializedMetadata = await AsyncStorage.getItem(CACHE_METADATA_KEY);
  if (!serializedMetadata) return null;

  const metadataValue: unknown = JSON.parse(serializedMetadata);
  if (!isOvertureCacheMetadata(metadataValue)) return null;

  const file = new File(metadataValue.local_uri);
  const expectedFile = await getVersionedFile(metadataValue, false);
  if (!expectedFile || file.uri !== expectedFile.uri) return null;
  if (!(await validateFileAgainstMetadata(file, metadataValue))) return null;

  return { metadata: metadataValue, local_uri: file.uri };
}

export async function readCachedOvertureSearchIndex(): Promise<OvertureSearchRecord[] | null> {
  const cached = await getCachedOvertureSearchArtifact();
  if (!cached) return null;

  try {
    const value: unknown = JSON.parse(await new File(cached.local_uri).text());
    return isSearchIndex(value) ? value : null;
  } catch {
    return null;
  }
}

export async function clearOvertureSearchCache(): Promise<void> {
  try {
    const directory = new Directory(Paths.document, CACHE_DIRECTORY_NAME, OVERTURE_DIRECTORY_NAME);
    if (directory.exists) await directory.delete();
  } catch {
    // The directory may already be absent or unavailable.
  }

  try {
    await AsyncStorage.removeItem(CACHE_METADATA_KEY);
  } catch {
    // Metadata may already be absent or unavailable.
  }
}

async function getFinalFile(manifest: OvertureSearchManifest, createDirectory: boolean): Promise<File | null> {
  return getVersionedFile(manifest, createDirectory);
}

async function getVersionedFile(
  version: Pick<OvertureSearchManifest, "release" | "pipeline_version" | "region">,
  createDirectory: boolean,
): Promise<File | null> {
  const [release, pipelineVersion, region] = versionedOvertureArtifactParts(version);
  const directory = new Directory(
    Paths.document,
    CACHE_DIRECTORY_NAME,
    OVERTURE_DIRECTORY_NAME,
    release,
    pipelineVersion,
    region,
  );

  if (createDirectory) await directory.create({ idempotent: true, intermediates: true });
  return new File(directory, "search-index.json");
}

async function validateFile(file: File, manifest: OvertureSearchManifest): Promise<boolean> {
  if (!file.exists) return false;
  const info = file.info();
  if (info.size !== manifest.search_artifact.byte_size) return false;
  const digest = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    await file.bytes(),
  );
  return arrayBufferToHex(digest) === manifest.search_artifact.sha256;
}

async function validateFileAgainstMetadata(file: File, metadata: OvertureCacheMetadata): Promise<boolean> {
  if (!file.exists) return false;
  const info = file.info();
  if (info.size !== metadata.byte_size) return false;
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, await file.bytes());
  return arrayBufferToHex(digest) === metadata.sha256;
}

function metadataFromManifest(
  manifest: OvertureSearchManifest,
  localUri: string,
): OvertureCacheMetadata {
  return {
    release: manifest.release,
    schema_version: manifest.schema_version,
    pipeline_version: manifest.pipeline_version,
    region: manifest.region,
    sha256: manifest.search_artifact.sha256,
    byte_size: manifest.search_artifact.byte_size,
    local_uri: localUri,
    downloaded_at: new Date().toISOString(),
  };
}
