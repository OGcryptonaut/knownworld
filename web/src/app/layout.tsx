import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { PrivacyProvider } from "@/components/PrivacyProvider";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Shell } from "@/components/Shell";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Knownworld",
  description: "this is my known world: warm-network job discovery from your own chats",
};

// applied before first paint so a stored light theme never flashes dark
const themeBootstrap = `try{if(localStorage.getItem('kw-theme')==='light')document.documentElement.classList.add('light')}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full bg-slate-950 text-slate-100">
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
        <ThemeProvider>
          <PrivacyProvider>
            <Shell>{children}</Shell>
          </PrivacyProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
