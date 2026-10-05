# Overture public discovery artifact

This directory defines the first local contract for the Overture pilot. It contains documentation and small fixtures only. It does not implement downloading, compression, mobile caching, backend validation, or venue materialization.

## 1. Source Overture

The source provider is:

```text
overture
```

The tested release is:

```text
2026-09-23.1
```

The tested Overture schema is:

```text
v2.0.0
```

The initial region is:

```text
comunitat_valenciana
```

The source identity used by the pilot is the Overture GERS ID. It is an external identifier only. `venues.id` remains Advisoret's canonical internal UUID and must continue to be used by ratings, rankings, views, routes, and `submit_rating_v1`.

## 2. Offline pipeline

The regional artifact is generated offline from an Overture release. The tested pipeline applies these rules:

- feature type is `place`;
- `taxonomy.hierarchy` contains `food_and_drink`;
- `confidence >= 0.7`;
- the main name is present;
- coordinates are present;
- `city` is present after locality enrichment;
- the legacy `categories` field is not used.

The resulting regional index contains 25,887 records for the tested release; this is the measured count of the real regional artifact. The offline pipeline is the authority for the artifact contents; the mobile snapshot is not.

`fixtures/sample-manifest.json` and `fixtures/sample-search-index.json` are small contract fixtures, not copies of that regional dataset. Therefore, the fixture's `record_count`, byte size, and SHA-256 are intentionally different from the measured real regional artifact.

## 3. Public discovery index

The public manifest describes the discovery artifact but does not expose private validation paths or credentials. The logical index format for this first step is JSON: an array of compact records.

Each discovery record contains only:

```text
id
name
city
address
lat
lon
primary
```

Field contract:

- `id`: Overture GERS ID with valid UUID syntax. For this pilot, fixtures and contractual validations expect the normalized lowercase UUID representation;
- `name`: non-empty primary display name;
- `city`: non-empty city after enrichment;
- `address`: string or `null`;
- `lat`: finite number in `[-90, 90]`;
- `lon`: finite number in `[-180, 180]`;
- `primary`: string or `null`, when the Overture primary taxonomy value is unavailable.

The index is for local discovery/autocomplete only. It is not a write authority and must never be used by the client to choose authoritative `name`, `city`, `address`, coordinates, or category during materialization.

## 4. Private authoritative validation shards

The future authoritative artifact will be maintained separately from this public discovery artifact. It will contain validation shards addressed by the first two hexadecimal characters of the normalized lowercase GERS ID representation:

```text
shard = first two characters of normalized lowercase GERS ID
```

There will be 256 shards. They will be private and accessible only to the backend materialization path. The client must never access or download them.

The public manifest intentionally does not contain private shard paths, credentials, or information required to access a private manifest.

## 5. Later materialization

The later flow will be:

```text
client GERS ID + release
  -> backend Edge Function
  -> private authoritative shard
  -> transactional RPC
  -> venues.id
```

The Edge Function will validate the requested GERS ID against the private shard. The RPC will materialize or retrieve the venue idempotently. The client's discovery snapshot can identify what the user selected, but it cannot become the authoritative input for database writes.

`venue_external_refs` will associate a generic provider/external identifier with the internal UUID. A GERS ID never replaces `venues.id`.

`venue_proposals` remains the visible manual fallback when Overture is disabled, unavailable, incomplete, or fails validation/materialization. Any future configuration or materialization failure must fail closed: Overture is OFF and the manual fallback remains available.

## 6. Discovery data versus authoritative data

| Concern | Public discovery index | Private authoritative artifact |
| --- | --- | --- |
| Purpose | Local search and autocomplete | Backend validation and materialization |
| Client access | Allowed | Forbidden |
| Database write authority | None | Used only by backend flow |
| Fields | Compact discovery fields | Canonical validated source snapshot |
| Artifact path | Public and immutable | Private and immutable |
| Failure behavior | Disable Overture search/fallback | Reject materialization/fallback |

Published artifacts are immutable per `(release, pipeline_version)` combination. `release` identifies the upstream Overture release, while `pipeline_version` identifies the Advisoret process that transforms it. The same Overture release may produce multiple Advisoret artifact versions when the pipeline changes. A correction to our pipeline increments `pipeline_version`; it does not invent a new Overture `release`. A new upstream Overture release changes `release`. Both values must be part of the artifact identity and versioning, and a published artifact must never be overwritten.

## 7. Public manifest example

`fixtures/sample-manifest.json` is a small contract fixture. Its `search_artifact.path` is a logical path containing both `release` and `pipeline_version`, not an absolute URL and not an environment-specific bucket path.

The manifest must include:

```text
provider
release
schema_version
pipeline_version
generated_at
region
record_count
search_artifact.path
search_artifact.format
search_artifact.byte_size
search_artifact.sha256
```

## 8. Verifiable invariants

These invariants should become automated tests in a later step:

- `provider` is `overture`;
- `release` is not empty;
- `pipeline_version` is not empty;
- `record_count` is a positive integer;
- `search_artifact.path` is non-empty and includes both `release` and `pipeline_version`;
- `search_artifact.format` is `json`;
- `search_artifact.byte_size` is a positive integer;
- `search_artifact.sha256` is a 64-character lowercase hexadecimal SHA-256;
- every record has a non-empty `id`;
- IDs are unique within the index;
- every record has a non-empty `name`;
- every record has a non-empty `city`;
- `lat` and `lon` are finite and within geographic range;
- `address` is either a string or `null`;
- `primary` is either a string or `null`;
- GERS IDs have valid UUID syntax for this pilot;
- the future authoritative shard is calculated from the first two hexadecimal characters of the normalized lowercase GERS ID;
- no public index field is considered authority for a database write;
- `venues.id` remains the canonical Advisoret UUID;
- GERS ID never replaces `venues.id`;
- public discovery artifacts contain no credentials or private shard paths;
- the same Overture `release` may have multiple artifact versions when `pipeline_version` changes;
- a published `(release, pipeline_version)` combination is immutable;
- published artifacts are never overwritten;
- a pipeline correction increments `pipeline_version`, while a new upstream release changes `release`;
- both `release` and `pipeline_version` form the artifact identity and versioning.
