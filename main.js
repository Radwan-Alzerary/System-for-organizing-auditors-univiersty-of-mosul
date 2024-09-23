const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const path = require("path");
const cors = require("cors");
const morgan = require("morgan");
const compression = require("compression");
const cookieParser = require("cookie-parser");
const session = require("express-session");
const flash = require("connect-flash");
const jwt = require("jsonwebtoken");
const { createClient } = require("redis");
const Ride = require("./model/ride"); // Adjust the path to your Ride model
const Captain = require("./model/Driver"); // Adjust the path to your Ride model

// Initialize Express app and HTTP server
const app = express();
const server = http.createServer(app);

// Initialize Socket.IO with WebSocket transport and CORS configuration
const io = require("socket.io")(server, {
  transports: ["websocket"],
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Create a Redis client
const redisClient = createClient({
  url: "redis://127.0.0.1:6379",
});

redisClient.on("error", (err) => {
  console.error("Redis error:", err);
});

redisClient
  .connect()
  .then(() => {
    console.log("Connected to Redis");
  })
  .catch(console.error);

// Object to keep track of online users and their socket IDs
const onlineCustomers = {};
const onlineCaptains = {};

// Map to keep track of dispatch processes
const dispatchProcesses = new Map();

// Function to find nearby captains using Redis geospatial commands
const findNearbyCaptains = async (origin, radius = 2) => {
  try {
    const nearbyCaptains = await redisClient.sendCommand([
      'GEORADIUS',
      'captains',
      origin.longitude.toString(),
      origin.latitude.toString(),
      radius.toString(),
      'km',
      'WITHCOORD',
      'WITHDIST',
      'ASC'
    ]);

    // Transform the result into an array of captain IDs
    return nearbyCaptains.map((captainData) => captainData[0]);
  } catch (err) {
    console.error('Error in findNearbyCaptains:', err);
    throw err;
  }
};

// Function to calculate the distance between two coordinates
function calculateDistance(coord1, coord2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const R = 6371; // Earth's radius in km

  const dLat = toRad(coord2.latitude - coord1.latitude);
  const dLon = toRad(coord2.longitude - coord1.longitude);

  const lat1 = toRad(coord1.latitude);
  const lat2 = toRad(coord2.latitude);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2) *
    Math.cos(lat1) *
    Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in km
}

// Socket.IO namespace for customers
const customerNamespace = io.of("/customer");
customerNamespace.on("connection", (socket) => {
  const token = socket.handshake.query.token;

  // Verify JWT token
  jwt.verify(token, "kishan sheth super secret key", async (err, decoded) => {
    if (err) {
      console.log("JWT verification failed for customer");
      socket.disconnect();
    } else {
      const customerId = decoded.id;
      onlineCustomers[customerId] = socket.id;

      console.log(`Customer ${customerId} connected with socket ID ${socket.id}`);

      // Listen for ride requests from customer
      socket.on("requestRide", async (rideData) => {
        try {
          if (
            typeof rideData.origin.latitude === "number" &&
            typeof rideData.origin.longitude === "number" &&
            typeof rideData.destination.latitude === "number" &&
            typeof rideData.destination.longitude === "number"
          ) {
            // Create a new ride instance
            const newRide = new Ride({
              passenger: customerId,
              driver: null,
              pickupLocation: {
                coordinates: [
                  rideData.origin.longitude,
                  rideData.origin.latitude,
                ],
              },
              dropoffLocation: {
                coordinates: [
                  rideData.destination.longitude,
                  rideData.destination.latitude,
                ],
              },
              fare: {
                amount: 6000,
                currency: "IQD",
              },
              distance: rideData.distance,
              duration: rideData.duration,
              status: "requested",
            });

            // Save the new ride to MongoDB
            await newRide.save();
            console.log(`Ride created for customer ${customerId}`);

            // Start the dispatch process
            dispatchRide(newRide, rideData.origin);
          } else {
            socket.emit("rideError", "Invalid location data. Please try again.");
          }
        } catch (err) {
          console.error("Error creating or broadcasting ride:", err);
          socket.emit("rideError", "Failed to create ride. Please try again.");
        }
      });

      socket.on("disconnect", () => {
        console.log("A customer disconnected");
        for (let customerId in onlineCustomers) {
          if (onlineCustomers[customerId] === socket.id) {
            delete onlineCustomers[customerId];
            console.log(`Customer ${customerId} disconnected`);
            break;
          }
        }
      });
    }
  });
});

// Socket.IO namespace for captains
const captainNamespace = io.of("/captain");
captainNamespace.on("connection", (socket) => {
  const token = socket.handshake.query.token;

  // Verify JWT token
  jwt.verify(token, "kishan sheth super secret key", async (err, decoded) => {
    if (err) {
      console.log("JWT verification failed for captain");
      socket.disconnect();
    } else {
      const captainId = decoded.id;
      onlineCaptains[captainId] = socket.id;

      console.log(`Captain ${captainId} connected with socket ID ${socket.id}`);

      // Send any pending ride requests within the captain's area
      const captainLocation = await redisClient.geoPos('captains', captainId);
      if (captainLocation && captainLocation.length > 0 && captainLocation[0]) {
        console.log(`Captain ${captainId} is at location:`, captainLocation[0]);
        const { longitude, latitude } = captainLocation[0];
        const pendingRides = await Ride.find({ status: "requested" });

        for (let ride of pendingRides) {
          const distance = calculateDistance(
            { latitude, longitude },
            {
              latitude: ride.pickupLocation.coordinates[1],
              longitude: ride.pickupLocation.coordinates[0],
            }
          );
          if (distance <= 10) { // Adjust the distance threshold as needed
            // Send the ride request to the captain
            socket.emit("newRide", {
              rideId: ride._id,
              pickupLocation: ride.pickupLocation.coordinates,
              dropoffLocation: ride.dropoffLocation.coordinates,
              fare: ride.fare.amount,
              distance: ride.distance,
              duration: ride.duration,
            });
          }
        }
      }

      // Listen for location updates from captain
      socket.on("updateLocation", async (data) => {
        try {
          await redisClient.geoAdd('captains', {
            longitude: data.longitude,
            latitude: data.latitude,
            member: captainId
          });
          console.log(`Location for captain ${captainId} updated in Redis`);

          // Send captain's location to the associated customer if on an active ride
          if (rideSharingMap.has(captainId)) {
            const customerId = rideSharingMap.get(captainId);
            if (onlineCustomers[customerId]) {
              io.of("/customer")
                .to(onlineCustomers[customerId])
                .emit("driverLocationUpdate", {
                  latitude: data.latitude,
                  longitude: data.longitude,
                });
            }
          }

          // ... existing code to check for pending rides and automatic arrival/completion detection ...
        } catch (err) {
          console.error("Error saving location to Redis:", err);
        }
      });

      // Listen for captain accepting ride
      socket.on("acceptRide", async (rideId) => {
        try {
          const ride = await Ride.findOneAndUpdate(
            { _id: rideId, status: "requested" },
            { $set: { status: "accepted", driver: captainId } },
            { new: true }
          );

          if (ride) {
            // Ride was successfully updated
            console.log(`Captain ${captainId} accepted ride ${rideId}`);

            // Fetch captain's info from the database
            const captainInfo = await Captain.findById(captainId); // Adjust model name and query as needed
            console.log(captainInfo);
            // Notify the customer with captain's info
            if (onlineCustomers[ride.passenger]) {
              io.of("/customer")
                .to(onlineCustomers[ride.passenger])
                .emit("rideAccepted", {
                  rideId: ride._id,
                  driverId: captainId,
                  driverInfo: {
                    name: captainInfo.name,
                    vehicle: captainInfo.carDetails,
                    phoneNumber: captainInfo.phoneNumber,
                    // Add any other relevant info
                  }, name


                });
            }

            // Signal the dispatch process to stop
            if (dispatchProcesses.has(rideId.toString())) {
              const cancelFunction = dispatchProcesses.get(rideId.toString());
              cancelFunction();
            }

            // Start sharing captain's location with customer
            rideSharingMap.set(captainId, ride.passenger);
          } else {
            // Ride was not found or already accepted
            socket.emit("rideError", "Ride not found or already accepted.");
          }
        } catch (err) {
          console.error("Error accepting ride:", err);
          socket.emit("rideError", "Failed to accept ride. Please try again.");
        }
      });

      // Listen for captain canceling the ride
      socket.on("cancelRide", async (rideId) => {
        try {
          const ride = await Ride.findOne({ _id: rideId, driver: captainId });
          if (ride && (ride.status === "accepted" || ride.status === "onRide")) {
            // Update ride status back to 'requested'
            ride.status = "requested";
            ride.driver = null;
            await ride.save();

            // Remove from rideSharingMap
            rideSharingMap.delete(captainId);

            // Notify the customer
            if (onlineCustomers[ride.passenger]) {
              io.of("/customer")
                .to(onlineCustomers[ride.passenger])
                .emit("rideCanceled", {
                  rideId: ride._id,
                  message: "The captain has canceled the ride. Searching for another captain...",
                });
            }

            // Restart the dispatch process
            dispatchRide(ride, {
              latitude: ride.pickupLocation.coordinates[1],
              longitude: ride.pickupLocation.coordinates[0],
            });
          } else {
            socket.emit("rideError", "Cannot cancel ride at this stage.");
          }
        } catch (err) {
          console.error("Error canceling ride:", err);
          socket.emit("rideError", "Failed to cancel ride. Please try again.");
        }
      });

      // Listen for captain starting the ride
      socket.on("startRide", async (rideId) => {
        try {
          const ride = await Ride.findOneAndUpdate(
            { _id: rideId, driver: captainId, status: "arrived" },
            { $set: { status: "onRide" } },
            { new: true }
          );

          if (ride) {
            // Notify the customer
            if (onlineCustomers[ride.passenger]) {
              io.of("/customer")
                .to(onlineCustomers[ride.passenger])
                .emit("rideStarted", {
                  rideId: ride._id,
                });
            }
            socket.emit("rideStarted", {
              rideId: ride._id,
            });
          } else {
            socket.emit("rideError", "Cannot start ride at this stage.");
          }
        } catch (err) {
          console.error("Error starting ride:", err);
          socket.emit("rideError", "Failed to start ride. Please try again.");
        }
      });

      socket.on("disconnect", () => {
        console.log("A captain disconnected");
        for (let captainId in onlineCaptains) {
          if (onlineCaptains[captainId] === socket.id) {
            delete onlineCaptains[captainId];
            console.log(`Captain ${captainId} disconnected`);
            break;
          }
        }
      });
    }
  });
});

// Function to handle ride dispatching
async function dispatchRide(ride, origin) {
  let radius = 2; // Starting radius in km
  const maxRadius = 10; // Maximum search radius
  const radiusIncrement = 0.5; // Radius increment in km
  const rideId = ride._id.toString();
  let cancelDispatch = false;

  // Store a cancellation function
  dispatchProcesses.set(rideId, () => {
    cancelDispatch = true;
  });

  try {
    while (!cancelDispatch && radius <= maxRadius) {
      const nearbyCaptains = await findNearbyCaptains(origin, radius);

      if (nearbyCaptains.length > 0) {
        for (let captainId of nearbyCaptains) {
          if (cancelDispatch) break;

          if (onlineCaptains[captainId]) {
            const captainSocketId = onlineCaptains[captainId];

            // Send the ride request to the captain
            io.of("/captain")
              .to(captainSocketId)
              .emit("newRide", {
                rideId: ride._id,
                pickupLocation: ride.pickupLocation.coordinates,
                dropoffLocation: ride.dropoffLocation.coordinates,
                fare: ride.fare.amount,
                distance: ride.distance,
                duration: ride.duration,
              });

            console.log(`Sent ride ${rideId} to captain ${captainId}`);

            // Wait for 10 seconds
            await new Promise((resolve) => setTimeout(resolve, 10000));

            // Check if the ride has been accepted
            const updatedRide = await Ride.findById(rideId);

            if (updatedRide.status === "accepted") {
              // Ride was accepted; stop dispatching
              cancelDispatch = true;
              console.log(`Ride ${rideId} accepted by captain ${captainId}`);
              break;
            } else {
              console.log(`Captain ${captainId} did not accept ride ${rideId}`);
            }
          }
        }
      } else {
        console.log(`No captains found within radius: ${radius} km`);
      }

      if (!cancelDispatch) {
        // Increase the radius
        radius += radiusIncrement;
        console.log(`Increasing search radius to: ${radius} km`);
      }
    }

    if (!cancelDispatch) {
      console.log(`No captains accepted ride ${rideId} after reaching max radius`);
      // Update the ride status to 'unassigned' or another appropriate status
      ride.status = "unassigned";
      await ride.save();

      // Notify the customer
      if (onlineCustomers[ride.passenger]) {
        io.of("/customer")
          .to(onlineCustomers[ride.passenger])
          .emit("noCaptainsAvailable", {
            rideId: ride._id,
            message: "No captains are available at the moment. Please try again later.",
          });
      }
    }
  } catch (err) {
    console.error("Error in dispatchRide:", err);
  } finally {
    // Clean up
    dispatchProcesses.delete(rideId);
  }
}

// Middleware and other configurations
require("dotenv").config();
require("./config/database");
require("./model/user");

const corsOptions = {
  origin: [
    /^(http:\/\/.+:8080)$/,
    /^(http:\/\/.+:8085)$/,
    /^(http:\/\/.+:80)$/,
    /^(http:\/\/.+:3001)$/,
    /^(http:\/\/.+:3000)$/,
    /^(http:\/\/.+:5000)$/,
    /^(http:\/\/.+:5001)$/,
  ],
  credentials: true,
  "Access-Control-Allow-Credentials": true,
};

app.use(cors(corsOptions));
app.use(compression());
app.use(morgan("dev"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(flash());

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

app.use(require("./routes"));

const SystemSetting = require("./model/systemSetting");

SystemSetting.countDocuments()
  .then((count) => {
    if (count === 0) {
      const systemSetting = new SystemSetting({
        name: "main",
        screenImg: "img/background.png",
      });
      systemSetting
        .save()
        .then(() => console.log("Default SystemSetting document created."))
        .catch((err) =>
          console.error("Error creating SystemSetting document:", err)
        );
    }
  })
  .catch((err) => console.error("Error checking SystemSetting collection:", err));

// Start the server on the specified port
const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
