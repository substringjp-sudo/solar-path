const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");

const packageName = "com.pplaner.beforeglow";
const keyPath = path.join(__dirname, "p-plan-5c00df855290.json");
const key = require(keyPath);

function readMetadata(lang) {
  const baseDir = path.join(__dirname, "..", "fastlane", "metadata", "android", lang);
  return {
    title: fs.readFileSync(path.join(baseDir, "title.txt"), "utf8").trim(),
    shortDescription: fs.readFileSync(path.join(baseDir, "short_description.txt"), "utf8").trim(),
    fullDescription: fs.readFileSync(path.join(baseDir, "full_description.txt"), "utf8").trim(),
  };
}

async function run() {
  const auth = new google.auth.JWT(
    key.client_email,
    null,
    key.private_key,
    ["https://www.googleapis.com/auth/androidpublisher"]
  );

  const play = google.androidpublisher({
    version: "v3",
    auth,
  });

  console.log("1. Starting edit session...");
  const editRes = await play.edits.insert({
    packageName: packageName,
  });
  const editId = editRes.data.id;
  console.log(`Edit session created: ${editId}`);

  try {
    const languages = ["ko-KR", "en-US"];

    for (const lang of languages) {
      console.log(`2. Reading metadata for ${lang}...`);
      const meta = readMetadata(lang);
      console.log(`Title: ${meta.title}`);
      console.log(`Short: ${meta.shortDescription}`);

      console.log(`3. Updating listing for ${lang}...`);
      await play.edits.listings.update({
        packageName: packageName,
        editId: editId,
        language: lang,
        requestBody: {
          title: meta.title,
          shortDescription: meta.shortDescription,
          fullDescription: meta.fullDescription,
        },
      });
      console.log(`Listing for ${lang} updated successfully.`);
    }

    console.log("4. Committing edit session...");
    await play.edits.commit({
      packageName: packageName,
      editId: editId,
    });
    console.log("Google Play Store listings updated and committed successfully!");
  } catch (error) {
    console.error("Error during listing update:", error);
  }
}

run();
