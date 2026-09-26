import { availability, capabilityLine, limitations } from "../../content/claims";

export default function Home() {
  return (
    <main>
      <h1>Faff</h1>
      <p>{capabilityLine}</p>
      <p>{limitations}</p>
      <p>{availability}</p>
    </main>
  );
}
