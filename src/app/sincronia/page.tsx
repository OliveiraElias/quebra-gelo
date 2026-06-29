import SincroniaRoom from "@/components/SincroniaRoom";

export const metadata = {
  title: "Sincronia Cósmica - Realtime",
  description: "Trabalhe em equipe ajustando frequências e defletores magnéticos em tempo real.",
};

export default function SincroniaPage() {
  return <SincroniaRoom roomId="strongers-sincronia" />;
}
