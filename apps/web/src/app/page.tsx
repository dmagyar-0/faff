import { availability, capabilityLine } from "../../content/claims";

export default function Home() {
  return (
    <main>
      <h1>Faff</h1>
      <p>{capabilityLine}</p>
      <p>{availability}</p>
    </main>
  );
}
