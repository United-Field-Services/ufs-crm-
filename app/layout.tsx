import type { Metadata, Viewport } from 'next';
import './globals.css';
export const metadata:Metadata={title:'UFS People | United Field Services',description:'Your people, time off, and documents. Together in one place.',robots:{index:false,follow:false},icons:{icon:'/favicon.svg'}};
// viewport-fit=cover lets the layout use the whole screen on phones with notches; the CSS keeps content inside the safe area.
export const viewport:Viewport={width:'device-width',initialScale:1,viewportFit:'cover',themeColor:'#163d7b'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
