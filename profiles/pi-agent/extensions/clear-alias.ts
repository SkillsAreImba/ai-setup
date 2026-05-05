export default function (pi: ExtensionAPI) {
  pi.on("input", async (event, ctx) => {
    if (event.text.startsWith("/clear")) {
      ctx.ui.notify("Using /new instead", "info");
      return { action: "transform", text: event.text.replace("/clear", "/new") };
    }
  });
}
