import { describe, expect, it } from "vitest";
import { geocodeLanguage } from "@/lib/weather";

describe("geocodeLanguage", () => {
  it("matches the script of the spoken place name", () => {
    expect(geocodeLanguage("कानपुर")).toBe("hi");
    expect(geocodeLanguage("గుంటూరు")).toBe("te");
    expect(geocodeLanguage("Kanpur")).toBe("en");
  });
});
