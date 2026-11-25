import { describe, expect, it } from "vitest";
import { stripUnreadPrefix, withUnreadPrefix } from "./unread-title";

describe("withUnreadPrefix", () => {
  it("adds, replaces and removes the badge", () => {
    expect(withUnreadPrefix("Inbox - OgaDesk", 3)).toBe("(3) Inbox - OgaDesk");
    expect(withUnreadPrefix("(3) Inbox - OgaDesk", 2)).toBe("(2) Inbox - OgaDesk");
    expect(withUnreadPrefix("(2) Inbox - OgaDesk", 0)).toBe("Inbox - OgaDesk");
  });

  it("caps at 99+", () => {
    expect(withUnreadPrefix("OgaDesk", 150)).toBe("(99+) OgaDesk");
    expect(withUnreadPrefix("(99+) OgaDesk", 4)).toBe("(4) OgaDesk");
  });

  it("leaves titles that merely start with a parenthesis alone", () => {
    expect(stripUnreadPrefix("(Beta) Reports")).toBe("(Beta) Reports");
  });
});
