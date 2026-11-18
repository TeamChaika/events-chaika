import { once } from "node:events";
import { createServer } from "node:http";
import { expect, test } from "@playwright/test";
import { createApp } from "../../server/index.mjs";

// Run after npm run build so the local server serves the current organizer UI.
test("organizer can create, change and clear an event notification chat", async ({
  browser,
  page,
  request,
}) => {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  let service;
  const other = await browser.newPage();
  try {
    service = await createApp({
      dbPath: ":memory:",
      databaseUrl: "",
      demo: true,
      testing: true,
      origin,
    });
    server.on("request", service.app);
    const title = "Проверка чата организатора";
    const personalChat = "123456789";
    const groupChat = "-1000123456789";
    const dialog = page.getByRole("dialog");
    const chat = dialog.getByRole("textbox", {
      name: "Telegram-чат для заказов и оплат",
    });
    const description = dialog.getByRole("textbox", {
      name: "Описание",
      exact: true,
    });
    const save = dialog.getByRole("button", { name: "Сохранить событие" });
    const otherDialog = other.getByRole("dialog");
    const otherSave = otherDialog.getByRole("button", {
      name: "Сохранить событие",
    });
    async function reopenEvent(view = page) {
      await expect(view.getByRole("dialog")).toBeHidden();
      await view.reload();
      await view
        .getByRole("article")
        .filter({ hasText: title })
        .getByRole("button", { name: "Редактировать" })
        .click();
    }

    await page.goto(`${origin}/admin`);
    await page.getByRole("button", { name: "Открыть демо-панель" }).click();
    await page.getByRole("button", { name: "Создать событие" }).click();
    await expect(chat).toHaveValue("");
    await expect(chat).toHaveAccessibleDescription(/общий чат/);
    await dialog.getByLabel("Название", { exact: true }).fill(title);
    for (const invalid of ["@group", "0", "4503599627370496"]) {
      await chat.fill(invalid);
      await save.click();
      await expect(chat).toBeFocused();
    }

    await chat.fill(personalChat);
    await save.click();
    await reopenEvent();
    await expect(chat).toHaveValue(personalChat);

    // The first organizer already has the event open when the second closes sales.
    await other.goto(`${origin}/admin`);
    await other.getByRole("button", { name: "Открыть демо-панель" }).click();
    await expect(
      other.getByRole("button", { name: "Создать событие" }),
    ).toBeVisible();
    await reopenEvent(other);
    await otherDialog.getByLabel("Открыть продажи").uncheck();
    await otherSave.click();
    await expect(otherDialog).toBeHidden();
    await chat.fill(groupChat);
    await save.click();
    await reopenEvent();
    await expect(chat).toHaveValue(groupChat);
    await expect(dialog.getByLabel("Открыть продажи")).not.toBeChecked();
    const catalog = await request.get(`${origin}/api/events`);
    expect(catalog.ok()).toBe(true);
    const publicEvent = (await catalog.json()).find((e) => e.title === title);
    expect(publicEvent).toBeDefined();
    expect(publicEvent).not.toHaveProperty("telegram_chat_id");

    // A combined chat and description edit also preserves concurrent changes.
    await reopenEvent(other);
    await otherDialog.getByLabel("Терминал СБП").selectOption("livadia");
    await otherDialog.getByLabel("Опубликовать на сайте").uncheck();
    await otherSave.click();
    await expect(otherDialog).toBeHidden();
    await chat.fill(personalChat);
    await description.fill("Новое описание");
    await save.click();
    await reopenEvent();
    await expect(chat).toHaveValue(personalChat);
    await expect(description).toHaveValue("Новое описание");
    await expect(dialog.getByLabel("Терминал СБП")).toHaveValue("livadia");
    await expect(dialog.getByLabel("Опубликовать на сайте")).not.toBeChecked();

    await reopenEvent(other);
    await otherDialog
      .getByLabel("Telegram-чат для заказов и оплат")
      .fill(groupChat);
    await otherSave.click();
    await expect(otherDialog).toBeHidden();
    await dialog.getByLabel("Дресс-код", { exact: true }).fill("Свободный");
    await save.click();
    await reopenEvent();
    await expect(chat).toHaveValue(groupChat);

    await chat.fill("");
    await save.click();
    await reopenEvent();
    await expect(chat).toHaveValue("");
  } finally {
    await other.close();
    await new Promise((resolve) => server.close(resolve));
    await service?.close();
  }
});
