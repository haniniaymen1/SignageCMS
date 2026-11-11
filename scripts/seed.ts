/**
 * Seed — données de démonstration pour SignageCMS
 * Exécuter : bun run scripts/seed.ts
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  console.log('🌱 Nettoyage de la base…')
  await db.proofOfPlay.deleteMany()
  await db.logEntry.deleteMany()
  await db.scheduleEvent.deleteMany()
  await db.campaignLayout.deleteMany()
  await db.campaign.deleteMany()
  await db.widget.deleteMany()
  await db.region.deleteMany()
  await db.layout.deleteMany()
  await db.playlist.deleteMany()
  await db.media.deleteMany()
  await db.display.deleteMany()
  await db.displayGroup.deleteMany()
  await db.user.deleteMany()
  await db.userGroup.deleteMany()
  await db.setting.deleteMany()

  console.log('🌱 Utilisateurs…')
  const grpAdmin = await db.userGroup.create({ data: { name: 'Administrateurs' } })
  const grpCom = await db.userGroup.create({ data: { name: 'Équipe Communication' } })
  await db.user.createMany({
    data: [
      { name: 'Admin', username: 'admin', email: 'admin@signage.local', role: 'admin', status: 'active', userGroupId: grpAdmin.id, lastLogin: new Date() },
      { name: 'Opérateur 1', username: 'operateur1', email: 'operateur1@signage.local', role: 'user', status: 'active', userGroupId: grpCom.id, lastLogin: new Date(Date.now() - 3600_000) },
      { name: 'Observateur 1', username: 'observateur1', email: 'observateur1@signage.local', role: 'read-only', status: 'active', userGroupId: grpCom.id },
      { name: 'Opérateur 2', username: 'operateur2', email: 'operateur2@signage.local', role: 'user', status: 'disabled', userGroupId: grpCom.id },
    ],
  })

  console.log('🌱 Écrans…')
  const gSiege = await db.displayGroup.create({ data: { name: 'Écrans Siège' } })
  const gBoutique = await db.displayGroup.create({ data: { name: 'Écrans Boutique' } })
  await db.display.createMany({
    data: [
      { hardwareKey: 'KEY-HALL-001', name: "Écran Hall d'accueil", description: 'Panneau LED 55 pouces', status: 'online', groupId: gSiege.id, resolution: '1920x1080', lastAccess: new Date(), storageUsed: 128 },
      { hardwareKey: 'KEY-CAFET-002', name: 'Écran Cafétéria', description: 'Menu du jour', status: 'online', groupId: gSiege.id, resolution: '1920x1080', lastAccess: new Date(Date.now() - 120_000), storageUsed: 96 },
      { hardwareKey: 'KEY-VITR-003', name: 'Vitrine Boutique', description: 'Vidéo murale portrait', status: 'online', groupId: gBoutique.id, resolution: '1080x1920', lastAccess: new Date(Date.now() - 300_000), storageUsed: 240 },
      { hardwareKey: 'KEY-REUN-004', name: "Écran Salle Réunion", description: 'Indicateur de réservation', status: 'offline', groupId: gSiege.id, resolution: '1280x720', lastAccess: new Date(Date.now() - 86_400_000), storageUsed: 64 },
      { hardwareKey: 'KEY-CAISSE-005', name: 'Écran Caisse', description: 'Promotions en caisse', status: 'offline', groupId: gBoutique.id, resolution: '1920x1080', lastAccess: new Date(Date.now() - 172_800_000), storageUsed: 512 },
    ],
  })

  console.log('🌱 Médias…')
  const mWelcome = await db.media.create({ data: { name: 'Bienvenue Siège', type: 'image', fileName: 'demo-welcome.svg', fileSize: 2048, url: '/uploads/demo-welcome.svg', duration: 8, tags: 'accueil' } })
  const mMenu = await db.media.create({ data: { name: 'Menu du Jour', type: 'image', fileName: 'demo-menu.svg', fileSize: 3072, url: '/uploads/demo-menu.svg', duration: 12, tags: 'restaurant' } })
  const mPromo = await db.media.create({ data: { name: 'Soldes Hiver -50%', type: 'image', fileName: 'demo-promo.svg', fileSize: 2816, url: '/uploads/demo-promo.svg', duration: 10, tags: 'promo,soldes' } })
  const mMeeting = await db.media.create({ data: { name: "Réservation Salle Atlantic", type: 'image', fileName: 'demo-meeting.svg', fileSize: 1892, url: '/uploads/demo-meeting.svg', duration: 6, tags: 'réunion' } })

  console.log('🌱 Présentations…')
  // 1. Accueil Hall — publiée
  const lAccueil = await db.layout.create({
    data: {
      name: 'Accueil Hall',
      description: "Présentation d'accueil pour le hall du siège",
      width: 1920, height: 1080, duration: 30,
      backgroundColor: '#0f172a', status: 'publie',
      regions: {
        create: [
          {
            name: 'Image principale', left: 0, top: 0, width: 100, height: 82, zIndex: 1,
            widgets: { create: [{ type: 'image', name: 'Bienvenue Siège', duration: 15, mediaId: mWelcome.id, config: '{}', position: 0 }] },
          },
          {
            name: 'Horloge', left: 68, top: 82, width: 32, height: 18, zIndex: 2,
            widgets: {
              create: [
                { type: 'clock', name: 'Horloge', duration: 15, config: JSON.stringify({ size: 56, color: '#f8fafc' }), position: 0 },
              ],
            },
          },
        ],
      },
    },
  })

  // 2. Menu Restaurant — publiée
  const lMenu = await db.layout.create({
    data: {
      name: 'Menu Restaurant',
      description: 'Affichage du menu du jour à la cafétéria',
      width: 1920, height: 1080, duration: 40,
      backgroundColor: '#141d2e', status: 'publie',
      regions: {
        create: [
          {
            name: 'Menu', left: 0, top: 0, width: 100, height: 80, zIndex: 1,
            widgets: { create: [{ type: 'image', name: 'Menu du Jour', duration: 20, mediaId: mMenu.id, config: '{}', position: 0 }] },
          },
          {
            name: 'Bandeau actualités', left: 0, top: 80, width: 100, height: 20, zIndex: 2,
            widgets: {
              create: [
                { type: 'rss', name: 'Actualités entreprise', duration: 20, config: JSON.stringify({ title: 'Infos interne' }), position: 0 },
              ],
            },
          },
        ],
      },
    },
  })

  // 3. Promotions Boutique — brouillon
  const lPromo = await db.layout.create({
    data: {
      name: 'Promotions Boutique',
      description: 'Vitrine promotionnelle portrait',
      width: 1080, height: 1920, duration: 25,
      backgroundColor: '#1c1917', status: 'brouillon',
      regions: {
        create: [
          {
            name: 'Bannière promo', left: 0, top: 0, width: 100, height: 60, zIndex: 1,
            widgets: {
              create: [
                { type: 'image', name: 'Soldes Hiver -50%', duration: 10, mediaId: mPromo.id, config: '{}', position: 0 },
                { type: 'image', name: 'Réservation Salle Atlantic', duration: 10, mediaId: mMeeting.id, config: '{}', position: 1 },
              ],
            },
          },
          {
            name: 'Météo', left: 0, top: 60, width: 100, height: 40, zIndex: 2,
            widgets: {
              create: [
                { type: 'weather', name: 'Météo locale', duration: 15, config: JSON.stringify({ city: 'Paris' }), position: 0 },
              ],
            },
          },
        ],
      },
    },
  })

  console.log('🌱 Affectation des présentations aux écrans…')
  const hall = await db.display.findUnique({ where: { hardwareKey: 'KEY-HALL-001' } })
  const cafet = await db.display.findUnique({ where: { hardwareKey: 'KEY-CAFET-002' } })
  const vitrine = await db.display.findUnique({ where: { hardwareKey: 'KEY-VITR-003' } })
  if (hall) await db.display.update({ where: { id: hall.id }, data: { layoutId: lAccueil.id } })
  if (cafet) await db.display.update({ where: { id: cafet.id }, data: { layoutId: lMenu.id } })
  if (vitrine) await db.display.update({ where: { id: vitrine.id }, data: { layoutId: lPromo.id } })

  console.log('🌱 Playlists…')
  const pPromo = await db.playlist.create({
    data: {
      name: 'Promotions du jour',
      description: 'Rotation des bannières promotionnelles',
      widgets: {
        create: [
          { type: 'image', name: 'Soldes Hiver -50%', duration: 10, mediaId: mPromo.id, position: 0 },
          { type: 'text', name: 'Message boutique', duration: 8, config: JSON.stringify({ title: 'Offre limitée', message: '2 articles achetés, le 3e offert !', size: 40, color: '#ffffff' }), position: 1 },
          { type: 'image', name: 'Réservation Salle Atlantic', duration: 6, mediaId: mMeeting.id, position: 2 },
        ],
      },
    },
  })
  await db.playlist.create({
    data: {
      name: 'Infos pratiques',
      description: 'Horaires et informations utiles',
      widgets: {
        create: [
          { type: 'clock', name: 'Horloge', duration: 6, config: JSON.stringify({ size: 64, color: '#ffffff' }), position: 0 },
          { type: 'text', name: 'Horaires', duration: 10, config: JSON.stringify({ title: 'Horaires', message: 'Ouvert du lundi au samedi\n9h — 19h', size: 34, color: '#e2e8f0' }), position: 1 },
        ],
      },
    },
  })

  console.log('🌱 Campagnes…')
  const cHiver = await db.campaign.create({ data: { name: 'Campagne Hiver', description: 'Promotions et accueil hivernal' } })
  await db.campaignLayout.createMany({
    data: [
      { campaignId: cHiver.id, layoutId: lPromo.id, displayOrder: 1 },
      { campaignId: cHiver.id, layoutId: lAccueil.id, displayOrder: 2 },
    ],
  })

  console.log('🌱 Planification…')
  const now = new Date()
  const day = (offset: number, h: number, min = 0) => {
    const d = new Date(now)
    d.setDate(d.getDate() + offset)
    d.setHours(h, min, 0, 0)
    return d
  }
  await db.scheduleEvent.createMany({
    data: [
      { name: 'Accueil Hall permanent', type: 'layout', layoutId: lAccueil.id, displayGroupId: gSiege.id, start: day(-1, 7), end: day(3, 20), color: '#f97316' },
      { name: 'Menu du midi', type: 'layout', layoutId: lMenu.id, displayGroupId: gSiege.id, start: day(0, 11), end: day(0, 14, 30), isPriority: true, color: '#10b981' },
      { name: 'Campagne Hiver — vitrine', type: 'campaign', campaignId: cHiver.id, displayGroupId: gBoutique.id, start: day(0, 9), end: day(2, 19), color: '#8b5cf6' },
      { name: 'Menu du soir', type: 'layout', layoutId: lMenu.id, displayGroupId: gSiege.id, start: day(1, 18), end: day(1, 21), color: '#06b6d4' },
    ],
  })

  console.log('🌱 Journal et preuves de diffusion…')
  await db.logEntry.createMany({
    data: [
      { level: 'info', display: "Écran Hall d'accueil", message: 'Connexion du lecteur réussie', createdAt: new Date(Date.now() - 5 * 60_000) },
      { level: 'info', display: 'Écran Cafétéria', message: 'Présentation « Menu Restaurant » téléchargée', createdAt: new Date(Date.now() - 20 * 60_000) },
      { level: 'info', display: 'Vitrine Boutique', message: 'Nouvelle campagne affectée', createdAt: new Date(Date.now() - 45 * 60_000) },
      { level: 'avertissement', display: 'Écran Caisse', message: 'Espace de stockage faible (512 Mo utilisés)', createdAt: new Date(Date.now() - 2 * 3600_000) },
      { level: 'info', display: 'Système', message: 'Sauvegarde automatique terminée', createdAt: new Date(Date.now() - 3 * 3600_000) },
      { level: 'erreur', display: 'Écran Salle Réunion', message: 'Lecteur hors ligne depuis plus de 24 h', createdAt: new Date(Date.now() - 5 * 3600_000) },
      { level: 'info', display: 'Système', message: "Marie Dupont s'est connectée", createdAt: new Date(Date.now() - 6 * 3600_000) },
      { level: 'avertissement', display: 'Vitrine Boutique', message: 'Température du panneau élevée (68°C)', createdAt: new Date(Date.now() - 8 * 3600_000) },
      { level: 'info', display: 'Écran Caisse', message: 'Mise à jour du lecteur installée (v4.2.1)', createdAt: new Date(Date.now() - 26 * 3600_000) },
      { level: 'info', display: 'Système', message: 'Présentation « Promotions Boutique » créée', createdAt: new Date(Date.now() - 30 * 3600_000) },
    ],
  })

  const displays = ['Écran Hall', 'Écran Cafétéria', 'Vitrine Boutique']
  const medias = ['Bienvenue Siège', 'Menu du Jour', 'Soldes Hiver -50%', 'Réservation Salle Atlantic']
  const proofRows = []
  for (let d = 6; d >= 0; d--) {
    for (let i = 0; i < 9; i++) {
      const date = new Date(now)
      date.setDate(date.getDate() - d)
      date.setHours(8 + i, 0, 0, 0)
      proofRows.push({
        display: displays[i % 3],
        media: medias[(d + i) % 4],
        layout: 'Accueil Hall',
        count: 3 + ((d * 7 + i * 3) % 14),
        duration: 6 + ((i * 2) % 10),
        date,
      })
    }
  }
  await db.proofOfPlay.createMany({ data: proofRows })

  console.log('🌱 Paramètres…')
  await db.setting.createMany({
    data: [
      { key: 'cmsName', value: 'SignageCMS' },
      { key: 'language', value: 'fr' },
      { key: 'timezone', value: 'Europe/Paris' },
      { key: 'statsEnabled', value: 'true' },
      { key: 'playerApiKey', value: 'SK-LIVE-9X4A2B' },
    ],
  })

  console.log('✅ Seed terminé !')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
