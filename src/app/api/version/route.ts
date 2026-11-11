import { NextResponse } from 'next/server'
import { APP_VERSION } from '@/lib/version'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ app: 'SignageCMS', version: APP_VERSION })
}
