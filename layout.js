import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/bodoni-moda/600.css';
import '@fontsource/bodoni-moda/700.css';
import './globals.css';

export const metadata = {
  title: 'Azari · Reposición',
  description: 'Stock, reposición y pedidos a bodegas',
};
export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#ffffff' };

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
