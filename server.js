require("dotenv").config();
const express = require("express");
const { Client } = require("@notionhq/client");
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const dbId = process.env.DATABASE_ID;

app.use(express.static("public"));

// Generate past 30 days as YYYY-MM-DD strings
const getLast30Days = () => {
  const dates = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
};

// Fetch and normalize Notion data
async function fetchProgressData() {
  console.log("Fetching data from Notion...");

  const response = await notion.databases.query({
    database_id: dbId,
    page_size: 100,
    filter: {
      property: "Date",
      date: {
        on_or_after: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      },
    },
  });

  const dateMap = {};
  const recentDates = getLast30Days();
  for (const d of recentDates) {
    dateMap[d] = 0;
  }

  for (const page of response.results) {
    const props = page.properties;
    const dateRaw = props["Date"]?.date?.start;
    const progressRaw = props["Progress"]?.formula?.number;

    if (!dateRaw) {
      console.log("Skipping entry: no date");
      continue;
    }

    const date = dateRaw.split("T")[0];
    const progress = typeof progressRaw === "number" ? Math.round(progressRaw * 100) : 0;

    console.log(`Date: ${date} | Progress: ${progress}%`);

    if (dateMap.hasOwnProperty(date)) {
      dateMap[date] = progress;
    } else {
      console.log(`Date ${date} not in expected range.`);
    }
  }

  return {
    labels: Object.keys(dateMap),
    data: Object.values(dateMap),
  };
}

// Generate chart and save as image
async function generateChartImage({ labels, data }) {
  console.log("Generating chart...");
  const chartHtml = fs.readFileSync(path.join(__dirname, "views/chart.html"), "utf8");

  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();

  await page.setContent(chartHtml, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => typeof window.renderChart === "function");

  await page.evaluate(({ labels, data }) => {
    window.renderChart(labels, data);
  }, { labels, data });

  await page.waitForSelector("#chart");
  await new Promise(resolve => setTimeout(resolve, 1000));

  const chartElement = await page.$("#chart");
  await chartElement.screenshot({ path: "public/chart.png" });

  await browser.close();
  console.log("Chart image saved to public/chart.png");
}

// Serve refresh UI page at /view
app.get("/view", (req, res) => {
  res.sendFile(path.join(__dirname, "views/index.html"));
});

// Trigger chart refresh
app.get("/refresh", async (req, res) => {
  try {
    const chartData = await fetchProgressData();
    await generateChartImage(chartData);
    res.send("Chart updated!");
  } catch (err) {
    console.error("Error generating chart:", err);
    res.status(500).send("Failed to generate chart.");
  }
});

// Serve chart image with fallback if it doesn't exist
app.get("/", (req, res) => {
  const chartPath = path.join(__dirname, "public/chart.png");
  if (fs.existsSync(chartPath)) {
    res.sendFile(chartPath);
  } else {
    res.status(404).send("Chart not generated yet. Please visit /refresh first.");
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});