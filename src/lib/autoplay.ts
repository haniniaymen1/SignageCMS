// ============ Autoplay robuste (v3.11.13, ajusté v3.11.14) ============
// Problème : plusieurs navigateurs (Safari, Firefox, WebView Android, Chrome en
// « économiseur de données ») refusent l'autoplay d'une vidéo même MUTE si
// l'attribut HTML « muted » n'est pas présent au moment du chargement — or
// React ne pose que la propriété DOM `muted`, jamais l'attribut (bug React
// #10389). Refus → vidéo figée sur la 1re image ; le rattrapage passe par les
// re-tentatives ci-dessous et le 1er geste utilisateur.
//
// v3.11.14 — le bouton volume du lecteur web a été supprimé : le son est
// piloté UNIQUEMENT par la configuration CMS du widget (cfg.muted). La
// préférence locale « soundPreference » (localStorage) est retirée — elle
// pouvait faire démarrer une vidéo avec le son contrairement à la config CMS.
//
// Stratégie en 4 filets, partagée par le widget vidéo et le lecteur IPTV :
//   1. attribut « muted » posé avant tout chargement (defaultMuted via le ref) ;
//   2. play() explicite au montage ; en cas de NotAllowedError → passage muet
//      + play() (jamais refusé par les navigateurs) ;
//   3. re-tentative à chaque « canplay » si encore en pause ;
//   4. premier geste sur la page (clic/doigt/touche) : relance la lecture et
//      rétablit le son voulu par la configuration CMS si le navigateur l'avait
//      imposé muet. Après un geste, l'« activation collante » du navigateur
//      autorise le son pour les vidéos suivantes de la session.

/**
 * Lance la lecture et ne laisse JAMAIS la vidéo figée : si le navigateur
 * refuse l'autoplay (généralement à cause du son), repasse en muet et
 * retente — l'autoplay muet est toujours autorisé.
 */
export function robustPlay(video: HTMLVideoElement) {
  video.play().catch(() => {
    video.muted = true
    video.play().catch(() => {
      /* dernier recours : les re-tentatives canplay + geste prennent le relais */
    })
  })
}
