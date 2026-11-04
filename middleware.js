import { NextResponse } from 'next/server';

// Si APP_PASSWORD está seteada en Vercel, pide usuario/clave (cualquier usuario + esa clave).
export function middleware(req) {
  const pass = process.env.APP_PASSWORD;
  if (!pass) return NextResponse.next();
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Basic ')) {
    try {
      const [, p] = atob(auth.slice(6)).split(':');
      if (p === pass) return NextResponse.next();
    } catch {}
  }
  return new NextResponse('Acceso restringido', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Azari Reposicion"' },
  });
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
