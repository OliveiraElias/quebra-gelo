import type { Metadata } from "next";
import GameRoom from "@/components/GameRoom";

export const metadata: Metadata = {
  title: "Quebra-Gelo — Strongers 3",
  description: "Joguinhos cooperativos em tempo real para a célula Strongers 3. Pinte, sincronize e complete os desafios juntos!",
  openGraph: {
    title: "Quebra-Gelo — Strongers 3",
    description: "Joguinhos cooperativos em tempo real para a célula Strongers 3.",
    type: "website",
    locale: "pt_BR",
    images: [
      {
        url: "/og-home.png",
        width: 1200,
        height: 630,
        alt: "Quebra-Gelo Strongers 3 — Desenho, Circuito Elétrico e Mosaico Coletivo",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Quebra-Gelo — Strongers 3",
    description: "Joguinhos cooperativos em tempo real para a célula Strongers 3.",
    images: ["/og-home.png"],
  },
};

export default function Home() {
  return <GameRoom roomId="strongers-3" />;
}
