import Shell from '@/components/cms/shell'
import ClientGate from '@/components/cms/client-gate'
import { getSessionUserFromCookies } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// Porte d'entrée du CMS :
// - session cookie valide → CMS directement ;
// - sinon → ClientGate vérifie le jeton Bearer de secours (cookies bloqués
//   dans l'iframe de prévisualisation) avant de renvoyer vers /login.
export default async function Home() {
  const user = await getSessionUserFromCookies()
  if (user) return <Shell />
  return <ClientGate />
}
