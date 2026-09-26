import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { availability, capabilityLine, limitations } from "../../content/claims";
import Home from "./page";

// Rendered the same way as the page, so HTML escaping (e.g. of apostrophes) matches.
const html = (text: string) => renderToStaticMarkup(<>{text}</>);

describe("the placeholder page", () => {
  it("renders the capability line, its limits (I-12) and that Faff isn't open, from claims.ts", () => {
    const page = renderToStaticMarkup(<Home />);
    expect(page).toContain(html(capabilityLine));
    expect(page).toContain(html(limitations));
    expect(page).toContain(html(availability));
  });
});
