import { once } from "node:events";
import { createServer } from "node:http";
import { expect, test } from "@playwright/test";
import { createApp } from "../../server/index.mjs";
import { promotionService } from "../../server/promotion.mjs";

// Build the frontend first so the test exercises the same links guests use.
test("catalog and referral links keep campaign tags and respect attribution consent", async ({
  page,
}) => {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  let service;
  try {
    service = await createApp({
      dbPath: ":memory:",
      databaseUrl: "",
      demo: true,
      testing: true,
      origin,
    });
    server.on("request", service.app);
    const link = await promotionService(service.store, origin).createLink(
      {
        event_id: "red-moon",
        event_slug: "moon",
        slug: "partner",
        source_name: "Проверка афиши",
      },
      "fixture",
    );
    const campaign =
      "utm_source=poster&utm_content=part%261&utm_content=part+2";
    const canonical = `/e/moon?${campaign}`;
    const referral = `${origin}/moon/partner?event=another&${campaign}&token=private&preview=1#unrelated`;
    const attribution = () =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("chaika.attribution.v1") || "null"),
      );

    await page.goto(
      `${origin}/?cookies=settings&event=&token=private&${campaign}&preview=1#unrelated`,
    );
    const card = page.getByRole("link", {
      name: "Ночь красной луны",
      exact: true,
    });
    await expect(card).toHaveAttribute("href", canonical);
    await page.getByRole("button", { name: "Только необходимые" }).click();
    await card.click();
    await expect(page).toHaveURL(origin + canonical);

    await page.goto(referral);
    await expect(page).toHaveURL(origin + canonical);
    expect(await attribution()).toBeNull();

    await page.goto(`${origin}/?cookies=settings`);
    await page.getByRole("button", { name: "Разрешить аналитику" }).click();
    await page.goto(referral);
    await expect(page).toHaveURL(origin + canonical);
    expect((await attribution())["red-moon"]).toMatchObject({
      first: link.id,
      last: link.id,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await service?.close();
  }
});
