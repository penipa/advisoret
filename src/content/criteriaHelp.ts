// src/content/criteriaHelp.ts
// Tooltips por criterio preparados para multi-producto.
// Hoy: esmorzaret. Mañana: tiramisú/paella/orxata… sin tocar pantallas.
import i18n from "../i18n";

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
const helpByCode: Record<string, { titleKey: string; bodyKey: string }> = {
  // ejemplos (si tus codes son distintos, no pasa nada: hay fallback por label)
  buen_gasto: {
    titleKey: "criteriaHelp.buen_gasto.title",
    bodyKey: "criteriaHelp.buen_gasto.body",
  },
  collarets: {
    titleKey: "criteriaHelp.collarets.title",
    bodyKey: "criteriaHelp.collarets.body",
  },
  producto: {
    titleKey: "criteriaHelp.producto.title",
    bodyKey: "criteriaHelp.producto.body",
  },
  pan: {
    titleKey: "criteriaHelp.pan.title",
    bodyKey: "criteriaHelp.pan.body",
  },
  cremaet: {
    titleKey: "criteriaHelp.cremaet.title",
    bodyKey: "criteriaHelp.cremaet.body",
  },
  ambiente: {
    titleKey: "criteriaHelp.ambiente.title",
    bodyKey: "criteriaHelp.ambiente.body",
  },
};

function toHelp(entry: { titleKey: string; bodyKey: string }): CriterionHelp {
  return {
    title: i18n.t(entry.titleKey),
    body: i18n.t(entry.bodyKey),
  };
}

function esmorzaretFallbackByLabel(labelRaw: string): { titleKey: string; bodyKey: string } | null {
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
  if (code && helpByCode[code]) return toHelp(helpByCode[code]);

  const label = pickLabel(c);

  // Por producto: hoy esmorzaret; mañana añades otros bloques
  if (productTypeId === ESMORZARET_PRODUCT_TYPE_ID) {
    const found = esmorzaretFallbackByLabel(label);
    return found ? toHelp(found) : null;
  }

  // Otros product types: por ahora no hay tooltips -> no se muestra icono
  return null;
}
