// src/content/criteriaHelp.ts
// Tooltips por criterio preparados para multi-producto.
// Hoy: esmorzaret. Mañana: tiramisú/paella/orxata… sin tocar pantallas.

export type CriterionLike = {
  id: string;
  code?: string | null;
  name_es?: string | null;
  name_en?: string | null;
};

export type CriterionHelp = {
  title: string;
  body: string;
};

const ESMORZARET_PRODUCT_TYPE_ID = "5b0af5a5-e73a-4381-9796-c6676c285206";

function norm(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function pickLabel(c: CriterionLike) {
  return (c.name_es || c.name_en || "").trim();
}

// Mapa por code si lo tenéis poblado en BD (lo ideal a futuro)
const helpByCode: Record<string, CriterionHelp> = {
  // ejemplos (si tus codes son distintos, no pasa nada: hay fallback por label)
  buen_gasto: {
    title: "Buen gasto",
    body: "Relación calidad/precio. Un 5 si lo que recibes compensa claramente lo que pagas; un 1 si te parece caro para lo que es.",
  },
  collarets: {
    title: "Collarets",
    body: "El ‘punch’ del esmorzaret: tamaño, contundencia y satisfacción general. Un 5 si sales feliz y completo; un 1 si te quedas a medias.",
  },
  producto: {
    title: "Producto",
    body: "Calidad de ingredientes y ejecución del bocata. Un 5 si el género y el punto están finos; un 1 si es flojo o industrial.",
  },
  pan: {
    title: "Pan",
    body: "Textura, frescura y equilibrio del pan con el contenido. Un 5 si suma (crujiente, buen punto); un 1 si resta (seco, chicle).",
  },
  cremaet: {
    title: "Cremaet",
    body: "Si lo pides: intensidad, equilibrio y ‘magia’. Un 5 si está redondo; un 1 si es flojo o mal montado.",
  },
  ambiente: {
    title: "Ambiente",
    body: "Servicio, ritmo, comodidad y vibes. Un 5 si repetirías por la experiencia; un 1 si te echa para atrás.",
  },
};

function esmorzaretFallbackByLabel(labelRaw: string): CriterionHelp | null {
  const l = norm(labelRaw);

  if (!l) return null;

  // Fallbacks por nombre (por si no hay code o cambian)
  if (l.includes("buen gasto") || (l.includes("calidad") && l.includes("precio"))) {
    return helpByCode.buen_gasto;
  }
  if (l.includes("collaret")) {
    return helpByCode.collarets;
  }
  if (l.includes("pan")) {
    return helpByCode.pan;
  }
  if (l.includes("cremaet") || l.includes("cremaet")) {
    return helpByCode.cremaet;
  }
  if (l.includes("ambiente") || l.includes("servicio")) {
    return helpByCode.ambiente;
  }
  if (l.includes("producto") || l.includes("ingrediente") || l.includes("genero")) {
    return helpByCode.producto;
  }

  return null;
}

export function getCriterionHelp(productTypeId: string, c: CriterionLike): CriterionHelp | null {
  const code = (c.code || "").trim();
  if (code && helpByCode[code]) return helpByCode[code];

  const label = pickLabel(c);

  // Por producto: hoy esmorzaret; mañana añades otros bloques
  if (productTypeId === ESMORZARET_PRODUCT_TYPE_ID) {
    return esmorzaretFallbackByLabel(label);
  }

  // Otros product types: por ahora no hay tooltips -> no se muestra icono
  return null;
}
