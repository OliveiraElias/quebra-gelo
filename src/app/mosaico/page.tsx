import type { Metadata } from "next";
import MosaicoRoom from "../../components/MosaicoRoom";

export const metadata: Metadata = {
  title: "Mosaico Coletivo — Strongers 3",
  description: "Pinte o mosaico em equipe! Cada jogador tem sua cor. Cooperem para completar o mosaico antes do tempo acabar. Jogue com o Strongers 3!",
  openGraph: {
    title: "Mosaico Coletivo — Strongers 3 🎨",
    description: "Cada jogador tem uma cor única. Pinte juntos. Vençam juntos.",
    type: "website",
    locale: "pt_BR",
    images: [
      {
        url: "/og-mosaico.png",
        width: 1200,
        height: 630,
        alt: "Mosaico Coletivo — jogo cooperativo do Strongers 3",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Mosaico Coletivo — Strongers 3 🎨",
    description: "Cada jogador tem uma cor única. Pinte juntos. Vençam juntos.",
    images: ["/og-mosaico.png"],
  },
};

export default function MosaicoPage() {
  return <MosaicoRoom roomId="strongers-mosaico" />;
}
