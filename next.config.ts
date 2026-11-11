import type { NextConfig } from "next";

/**
 * v3.11 — en-têtes de sécurité applicatifs :
 *  - nosniff partout (empêche le rebaptisage de type MIME par le navigateur) ;
 *  - Referrer-Policy sobre (ne divulgue pas les URL internes aux sites tiers) ;
 *  - X-Frame-Options SAMEORIGIN sur l'interface d'administration : interdit
 *    l'intégration du CMS dans un site externe (clickjacking). Le lecteur
 *    /player et les médias restent intégrables (cas mur d'écrans, OBS…).
 *
 * v3.11.2 — ALLOW_FRAME_EMBED=1 désactive X-Frame-Options sur l'interface
 * d'administration : à réserver aux cas où le CMS est volontairement intégré
 * dans un portail externe ou un panneau d'aperçu (iframe inter-origine).
 * Par défaut (variable absente), la protection anti-clickjacking reste active.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const allowFrameEmbed = process.env.ALLOW_FRAME_EMBED === "1";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  async headers() {
    const rules: {
      source: string;
      headers: { key: string; value: string }[];
    }[] = [
      {
        // En-têtes de base sur toutes les routes
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
    if (!allowFrameEmbed) {
      rules.push({
        // Interface d'administration : pas d'intégration depuis un autre site
        source: "/((?!player|uploads|api/webpage/proxy).*)",
        headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }],
      });
    }
    return rules;
  },
};

export default nextConfig;
