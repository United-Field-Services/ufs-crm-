import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'UFS People | United Field Services',description:'Your people, time off, and documents. Together in one place.',robots:{index:false,follow:false},icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
