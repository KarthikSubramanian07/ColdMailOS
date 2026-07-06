import { describe, it, expect } from "vitest";
import { htmlToText } from "../src/extract/fetchPage";

describe("htmlToText", () => {
  it("removes script/style/nav/header/footer content", () => {
    const html =
      `<nav>NAVLINKS</nav><header>HEADERBAR</header>` +
      `<script>var secret=1</script><style>.x{color:red}</style>` +
      `<p>Real content here</p><footer>FOOTERSTUFF</footer>`;
    const out = htmlToText(html);
    expect(out).toContain("Real content here");
    expect(out).not.toContain("NAVLINKS");
    expect(out).not.toContain("HEADERBAR");
    expect(out).not.toContain("FOOTERSTUFF");
    expect(out).not.toContain("secret=1");
    expect(out).not.toContain("color:red");
  });

  it("preserves mailto addresses as inline text (survives tag stripping)", () => {
    const out = htmlToText(`<a href="mailto:jane@x.edu">Jane Doe</a>`);
    expect(out).toContain("jane@x.edu");
    expect(out).toContain("Jane Doe");
  });

  it("preserves http hrefs as inline text (profile URLs)", () => {
    const out = htmlToText(`<a href="https://x.edu/~jane">profile</a>`);
    expect(out).toContain("profile (https://x.edu/~jane)");
  });

  it("decodes HTML entities", () => {
    expect(htmlToText("<p>A &amp; B &#64; C &nbsp;D</p>")).toContain("A & B @ C");
  });

  it("collapses excessive whitespace/newlines", () => {
    const out = htmlToText("<p>a</p>\n\n\n\n<p>b</p>");
    expect(out).not.toMatch(/\n{3,}/);
    expect(out).toContain("a");
    expect(out).toContain("b");
  });

  it("strips remaining tags", () => {
    expect(htmlToText("<div><span>hi</span></div>")).not.toContain("<");
  });
});
