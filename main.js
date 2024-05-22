// server.js

const express = require("express");
const http = require("http");

const app = express();
const server = http.createServer(app);
const io = require("socket.io")(server, {
  cors: {
    origin: "*",
    credentials: true,
    },
});
const path = require("path");
const cors = require("cors");

const corsOptions = {
  origin: [
    /^(http:\/\/.+:8080)$/,
    /^(http:\/\/.+:8085)$/,
    /^(http:\/\/.+:80)$/,
    /^(http:\/\/.+:3000)$/,
    /^(http:\/\/.+:5000)$/,
    /^(http:\/\/.+:5001)$/,
  ],
  credentials: true,
  "Access-Control-Allow-Credentials": true,
};


app.use(cors(corsOptions));

const morgan = require("morgan");
const compression = require("compression");
app.use(compression());
app.use(morgan("dev"));
const {
  ThermalPrinter,
  PrinterTypes,
  CharacterSet,
  BreakLine,
} = require("node-thermal-printer");

require("dotenv").config();
require("./config/database");
require("./config/database");
require("./model/user");
const cookieParser = require("cookie-parser");
const session = require("express-session");
const flash = require("connect-flash");
app.use(express.static(path.join(__dirname, "public")));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(flash());

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

app.use(require("./routes"));

// Function to send current time to all connected clients
const sendTime = () => {
  io.emit("time", { time: new Date().toLocaleTimeString() });
};
const puppeteer = require("puppeteer");
const Auditors = require("./model/auditors");

const browserPromise = puppeteer.launch(); // Launch the browser once

async function printImageAsync(imagePath, printincount) {
  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: `tcp://172.20.82.221//:9100`,
    // characterSet: CharacterSet.SLOVENIA,
    removeSpecialCharacters: false,
    lineCharacter: "=",
    breakLine: BreakLine.WORD,
    options: {
      timeout: 1000,
    },
  });
  try {
    printer.alignCenter();
    // await printer.printImage(`./public${setting.shoplogo}`); // Print PNG image
    await printer.printImage(imagePath); // Print PNG image
    await printer.cut();
    for (i = 0; i < printincount; i++) {
      await printer.execute();
    }
    console.log("Image printed successfully.");
  } catch (error) {
    console.error("Error printing image:", error);
  }
}

// Update time every second
setInterval(sendTime, 1000);

// Listen for incoming connections
io.on("connection", (socket) => {
  socket.on("add-user", (userId) => {
    onlineUsers.set(userId, socket.id);
  });

  socket.on("send-msg", (data) => {
    const sendUserSocket = onlineUsers.get(data.to);
    console.log(data);
    if (sendUserSocket) {
      socket.to(sendUserSocket).emit("msg-recieved", data.message);
    }
  });
  socket.on("send-book", (data) => {
    console.log(data);
    io.emit("book-received", "newBooked"); // You can emit to a specific room if needed
  });
  socket.on("new-patient", (data) => {
    console.log(data);
    io.emit("book-received", "newPatient"); // You can emit to a specific room if needed
  });
  socket.on("new", async (data) => {
    try {
      const lastAuditor = await Auditors.findOne().sort({ createdAt: -1 });
      const data = {};
      if (lastAuditor) {
        data.sequence = lastAuditor.sequence + 1;
      } else {
        data.sequence = 1;
      }
      data.state = "انتضار";
      const category = new Auditors(data);
      await category.save();
      const htmlContent = `<!DOCTYPE html>
      <html lang="ar">
        <head>
          <style>
            * {
              font-size: 1.4rem;
              margin: 0px;
              font-family: "Arial";
            }
      
            main {
              padding: 6px;
              width: 560px;
            }
      
            .dashed-line {
              border: none;
              height: 2px;
              /* Set the desired height for the dashed line */
              background-image: repeating-linear-gradient(
                to right,
                black,
                black 8px,
                transparent 8px,
                transparent 16px
              );
            }
      
            .centerdiv {
              display: flex;
              justify-content: center;
              align-items: center;
            }
      
            table,
            th,
            td {
              border: 1px solid black;
              border-collapse: collapse;
            }
      
            table {
              width: 100%;
            }
      
            th,
            td {
              text-align: center;
            }
          </style>
        </head>
      
        <body>
          <main>
            <div  style="height:800px; margin-top: 60px;display: flex;justify-items: center;align-items: center;justify-content: center;">
              <a style="font-size: 10rem;">${data.sequence}</a>
            </div>
      
            <div
              class="centerdiv"
              style="padding-top: 10px; text-align: center; font-size: 1.8rem"
            ></div>
          </main>
        </body>
      </html>
      `;

      const generateImage = async () => {
        const browser = await browserPromise; // Reuse the same browser instance
        const page = await browser.newPage();
        await page.setContent(htmlContent);

        await page.waitForSelector("main"); // Wait for the <main> element to be rendered
        const mainElement = await page.$("main"); // Select the <main> element

        await mainElement.screenshot({
          path: "./image.png",
          fullPage: false, // Capture only the <main> element
          javascriptEnabled: false,
          headless: true,
        });
        console.log("Image generation done");
      };

      await generateImage(); // Generate the image asynchronously
      await printImageAsync("./image.png", 1);
      io.emit("book-received", category); // You can emit to a specific room if needed
      console.log(data);
    } catch (error) {
      console.log(error);

      io.emit("book-received", "category"); // You can emit to a specific room if needed
    }
  });


  socket.on("ubdate", async () => {
    try {
      io.emit("book-received", "category"); // You can emit to a specific room if needed
    } catch (error) {
      console.log(error);

      io.emit("book-received", "category"); // You can emit to a specific room if needed
    }
  });


});

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
