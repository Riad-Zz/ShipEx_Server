// ============================= Required ===============================
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_KEY);

// =============== Initial Ports and Connections =============================
const app = express();
const port = process.env.PORT || 3000;

// ====================== MiddleWire ===================================
app.use(cors());
app.use(express.json());
const admin = require("firebase-admin");
// const serviceAccount = require("./firebasekey.json");
const decoded = Buffer.from(process.env.FIREBASE_KEY, "base64").toString(
  "utf8",
);
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// ============================ Test Api ===================================
app.get("/", (req, res) => {
  res.send("ShipEx is Running !");
});

// ====================== Tracking id generator ==========================
function generateTrackingId() {
  const time = Date.now().toString().slice(-4); // last 4 digits
  const random = Math.floor(100 + Math.random() * 900); // 3 digit random
  return `SHIPX-${time}${random}`;
}

// ====================== FireBase Token Varify ==========================
const firebaseTokenVarify = async (req, res, next) => {
  if (!req.headers.authorization) {
    return res.status(401).send({ message: "Unauthorize Access !" });
  }
  const token = req.headers.authorization.split(" ")[1];
  // console.log(token) ;
  try {
    const userInfo = await admin.auth().verifyIdToken(token);
    req.token_email = userInfo.email;
    // console.log(userInfo) ;
    next();
  } catch {
    return res.status(401).send({ message: "Unauthorize Access ! " });
  }
};

// ================== ** Mongo Uri and Mongo Client ** ==============================

// ------------------ Mongo Uri -----------------------
const uri = process.env.MONGO_URI;
//--------------------- Mongo Client --------------------
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

//====================== Connecting to MongoDB  ============================
async function run() {
  try {
    //---------------------- Reminder-> Comment this Out when deploying to vercel ----------------------
    // await client.connect();

    // *? ================================ Databases & all Collection here ==========================================
    const database = client.db("ShipEx");
    const parcelCollection = database.collection("percels");
    const paymentCollection = database.collection("payments");
    const userCollection = database.collection("users");
    const riderCollection = database.collection("riders");
    const logCollection = database.collection("parcellog");

    // *? ================================ MiddleWare to Varify Admin ==========================================
    const varifyAdmin = async (req, res, next) => {
      const email = req.token_email;
      const query = { email };
      const user = await userCollection.findOne(query);
      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "Unauthorize Access ! " });
      }
      next();
    };

    // *? ================================ Parcel Related APIs ==============================================
    //* ------------------- Api to get percel from Database ------------------------
    app.get("/parcel", async (req, res) => {
      const query = {};
      const { email, deliveryStatus, riderEmail } = req.query;
      if (email) {
        query.senderEmail = email;
      }
      if (riderEmail) {
        query.rider_email = riderEmail;
      }
      if (deliveryStatus) {
        query.deliveryStatus = deliveryStatus;
      }
      const cursor = await parcelCollection.find(query).sort({ createdAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    });

    //* ----------------------  APi to get Parcel By Id ----------------------
    app.get("/parcel/:id", firebaseTokenVarify, async (req, res) => {
      const parcel_id = req.params.id;
      const query = { _id: new ObjectId(parcel_id) };
      const result = await parcelCollection.findOne(query);
      res.send(result);
    });

    //* ----------------------  APi to delete Parcel By Id ----------------------
    app.delete("/parcel/:id", async (req, res) => {
      const parcel_id = req.params.id;
      const query = { _id: new ObjectId(parcel_id) };
      const result = await parcelCollection.deleteOne(query);
      res.send(result);
    });

    //* ----------------------  APi to Assign a Rider a Parcel ----------------------
    app.patch("/parcel/:id", async (req, res) => {
      const { rider_id, rider_name, rider_email } = req.body;
      const parcel_id = req.params.id;
      const query = { _id: new ObjectId(parcel_id) };

      const updatedInfo = {
        $set: {
          deliveryStatus: "rider_assigned",
          rider_id: rider_id,
          rider_name: rider_name,
          rider_email: rider_email,
        },
      };
      const result = await parcelCollection.updateOne(query, updatedInfo);
      const riderQuery = { _id: new ObjectId(rider_id) };
      const riderUpdate = {
        $set: {
          work_status: "assigned",
        },
      };
      const rider_result = await riderCollection.updateOne(
        riderQuery,
        riderUpdate,
      );
      // ------------  CREATE PARCEL LOG (TIMELINE) ---------------
      const parcelInfo = await parcelCollection.findOne(query);
      await logCollection.insertOne({
        parcel_id: parcel_id,
        tracking_id: parcelInfo.tracking_id,
        deliveryStatus: "rider_assigned",
        loggedAt: new Date(),
      });

      res.send(rider_result);
    });

    //* ----------------------  APi for Rider to Accept, Reject, or Update Status ----------------------
    app.patch(
      "/parcel/rider-update/:id",
      firebaseTokenVarify,
      async (req, res) => {
        const parcel_id = req.params.id;
        const { action, status, rider_id } = req.body;
        const parcelQuery = { _id: new ObjectId(parcel_id) };
        const riderQuery = rider_id ? { _id: new ObjectId(rider_id) } : null;

        try {
          // We fetch the parcel first because we need it for calculating earning AND logging the tracking_id
          const parcel = await parcelCollection.findOne(parcelQuery);

          if (action === "accept") {
            const calculatedEarning = Math.max(
              50,
              Math.floor((parcel.amount || 0) * 0.25),
            );
            const result = await parcelCollection.updateOne(parcelQuery, {
              $set: {
                deliveryStatus: "on-transit",
                rider_earning: calculatedEarning,
                cashout_status: "no",
              },
            });

            //------------  CREATE PARCEL LOG ---------------
            await logCollection.insertOne({
              parcel_id: parcel_id,
              tracking_id: parcel.tracking_id,
              deliveryStatus: "on-transit",
              loggedAt: new Date(),
            });

            return res.send({ ...result, rider_earning: calculatedEarning });
          }

          if (action === "reject") {
            const parcelUpdate = await parcelCollection.updateOne(parcelQuery, {
              $set: { deliveryStatus: "awaiting_pickup" },
              $unset: { rider_id: "", rider_name: "", rider_email: "" },
            });

            const riderUpdate = await riderCollection.updateOne(riderQuery, {
              $set: { work_status: "available" },
            });

            // ------------  CREATE PARCEL LOG ---------------
            await logCollection.insertOne({
              parcel_id: parcel_id,
              tracking_id: parcel.tracking_id,
              deliveryStatus: "awaiting_pickup", // Went back to awaiting pickup
              loggedAt: new Date(),
            });

            return res.send({ parcelUpdate, riderUpdate });
          }

          if (action === "update_status") {
            const parcelUpdate = await parcelCollection.updateOne(parcelQuery, {
              $set: { deliveryStatus: status },
            });

            if (status === "delivered") {
              await riderCollection.updateOne(riderQuery, {
                $set: { work_status: "available" },
              });
            }
            //------------  CREATE PARCEL LOG ---------------
            await logCollection.insertOne({
              parcel_id: parcel_id,
              tracking_id: parcel.tracking_id,
              deliveryStatus: status, // "picked_up", "delivered", etc.
              loggedAt: new Date(),
            });

            return res.send(parcelUpdate);
          }

          if (action === "cashout") {
            const result = await parcelCollection.updateOne(parcelQuery, {
              $set: { cashout_status: "yes" },
            });
            return res.send(result);
          }
        } catch (error) {
          res.status(500).send({ message: "Internal Server Error", error });
        }
      },
    );

    //* -------------------- Api to Add percel to Database ---------------------------
    app.post("/parcel", async (req, res) => {
      const newParcel = req.body;
      newParcel.createdAt = new Date();
      const result = await parcelCollection.insertOne(newParcel);
      res.send(result);
    });

    //* --------------- APi to get Payment history from db -----------------
    app.get("/payhistory", firebaseTokenVarify, async (req, res) => {
      const query = {};
      const email = req.query.email;
      // console.log(req) ;
      if (email) {
        query.customer_email = email;
      }
      const cursor = await paymentCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    // *? ================================ PAYMENT FUNCTIONALITY(STRIPE) RELATED APIS ==========================================
    //* ------------- Stripe Payment Gateway ----------------------
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const parcelAmoumt = parseInt(paymentInfo.amount) * 100;

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              product_data: {
                name: `Payment for parcel ${paymentInfo.parcelname}`,
              },
              unit_amount: parcelAmoumt,
              currency: "bdt",
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo.senderEmail,
        mode: "payment",
        metadata: {
          parcel_id: paymentInfo.id,
          receiver_name: paymentInfo.receiverName,
          receiver_address: paymentInfo.receiverAddress,
          receiver_contact: paymentInfo.receiverContact,
        },
        success_url: `${process.env.STRIPE_DOMAIN}/paymentsuccess?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.STRIPE_DOMAIN}/paymentcancel`,
      });

      // console.log(session);
      res.send({ url: session.url });
    });

    //* ------------------ Stripe Payment Varify and Update Info --------------------------
    app.patch("/session-status", async (req, res) => {
      const session_id = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(session_id);
      // console.log(session);
      const tracking_id = generateTrackingId();

      //------------- Prevent Duplicate Payment Entry ------------------
      const transaction_id = session.payment_intent;
      const query = { transaction_id: transaction_id };
      const payment_exist = await paymentCollection.findOne(query);
      if (payment_exist) {
        return res.send({
          message: "already Exist !!",
          tracking_id: tracking_id,
          transaction_id: payment_exist.transaction_id,
          tracking_id: payment_exist.tracking_id,
        });
      }

      if (session.payment_status === "paid") {
        const parcel_id = session.metadata.parcel_id;
        const query = { _id: new ObjectId(parcel_id) };
        const update = {
          $set: {
            deliveryStatus: "awaiting_pickup",
            paymentStatus: "paid",
            tracking_id: tracking_id,
          },
        };

        const result = await parcelCollection.updateOne(query, update);

        //* ------------  Create payment history info ---------------
        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customer_email: session.customer_email,
          parcel_id: session.metadata.parcel_id,
          receiverAddress: session.metadata.receiver_address,
          receiverContact: session.metadata.receiver_contact,
          receiverName: session.metadata.receiver_name,
          transaction_id: session.payment_intent,
          tracking_id: tracking_id,
          payment_status: session.payment_status,
          paidAt: new Date(),
        };

        const newPayment = await paymentCollection.insertOne(payment);
        // ------------  CREATE PARCEL LOG (TIMELINE) ---------------
        await logCollection.insertOne({
          parcel_id: session.metadata.parcel_id,
          tracking_id: tracking_id,
          deliveryStatus: "awaiting_pickup",
          loggedAt: new Date(),
        });

        res.send({
          success: true,
          modified_parce: result,
          tracking_id: tracking_id,
          transaction_id: session.payment_intent,
          payment_info: newPayment,
        });
      }
    });

    // *? ================================ User Related APis ==========================================
    // *-------------- api to save new user to database with role user -----------------------
    app.post("/users", async (req, res) => {
      const query = {};
      const userInfo = req.body;
      const email = userInfo?.email;
      if (email) {
        query.email = email;
      }
      const userExist = await userCollection.findOne(query);
      if (userExist) {
        return res.send({ message: "user already Exist !" });
      }
      userInfo.createdAt = new Date();
      userInfo.role = "user";
      const result = await userCollection.insertOne(userInfo);
      res.send(result);
    });

    // *-------------- api to get all the user from database-----------------------
    app.get("/users", async (req, res) => {
      const searchedValue = req.query.searched;
      const query = {};
      if (searchedValue) {
        query.$or = [
          { displayName: { $regex: searchedValue, $options: "i" } },
          { name: { $regex: searchedValue, $options: "i" } },
          { email: { $regex: searchedValue, $options: "i" } },
        ];
      }
      const cursor = await userCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    // *-------------- api to get a the user by Role from database-----------------------
    app.get("/users/:email/role", async (req, res) => {
      const { email } = req.params;
      const query = { email };
      const result = await userCollection.findOne(query);
      res.send({ role: result?.role || "user" });
    });

    // *-------------- api to get promote or Revoke a user to A Role-----------------------
    app.post(
      "/users/:id",
      firebaseTokenVarify,
      varifyAdmin,
      async (req, res) => {
        const user_id = req.params.id;
        const { status } = req.body;
        const query = { _id: new ObjectId(user_id) };
        const update = {
          $set: {
            role: status,
          },
        };
        const result = await userCollection.updateOne(query, update);
        res.send(result);
      },
    );

    // *-------------- api to save new Rider Request to database -----------------------
    app.post("/riders", async (req, res) => {
      const riderInfo = req.body;
      const query = {};
      const email = riderInfo.email;
      riderInfo.createdAt = new Date();
      riderInfo.status = "pending";
      if (email) {
        query.email = email;
      }
      const existingRider = await riderCollection.findOne(query);
      if (existingRider) {
        return res.send({ message: "Rider Already Exist !" });
      }
      const result = await riderCollection.insertOne(riderInfo);
      res.send(result);
    });

    // *-------------- api to get all the Rider from database -----------------------
    app.get("/riders", async (req, res) => {
      const { status, work_status, district } = req.query;
      const query = {};
      if (status) {
        query.status = status;
      }
      if (work_status) {
        query.work_status = work_status;
      }
      if (district) {
        query.district = district;
      }
      const cursor = await riderCollection.find(query).sort({ createdAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    });

    // *-------------- api to get a Rider from database by Specific id-----------------------
    app.get("/riders/:id", firebaseTokenVarify, async (req, res) => {
      const rider_id = req.params.id;
      const query = { _id: new ObjectId(rider_id) };
      const result = await riderCollection.findOne(query);
      res.send(result);
    });

    // *-------------- api to Approve OR Reject a Rider Application by Specific id-----------------------
    app.post(
      "/riders/:id",
      firebaseTokenVarify,
      varifyAdmin,
      async (req, res) => {
        const rider_id = req.params.id;
        const user_email = req.body.email;
        const status = req.body.status;
        const query = { _id: new ObjectId(rider_id) };
        const updateFields = {
          $set: {
            status: status,
            work_status: "available",
          },
        };
        const result = await riderCollection.updateOne(query, updateFields);
        if (status === "approved") {
          const roleQuery = { email: user_email };
          const roleUpdate = {
            $set: {
              role: "rider",
            },
          };
          const result = await userCollection.updateOne(roleQuery, roleUpdate);
        }
        res.send(result);
      },
    );

    // *? ================================ Dashboard Related APis ==========================================
    //* 1. Admin Dashboard Stats (Uses Aggregation)
    app.get(
      "/admin-stats",
      firebaseTokenVarify,
      varifyAdmin,
      async (req, res) => {
        try {
          const totalParcels = await parcelCollection.estimatedDocumentCount();
          const totalUsers = await userCollection.countDocuments({
            role: "user",
          });
          const totalRiders = await userCollection.countDocuments({
            role: "rider",
          });

          // Calculate Total Revenue from Payments
          const revenueResult = await paymentCollection
            .aggregate([
              { $match: { payment_status: "paid" } },
              { $group: { _id: null, total: { $sum: "$amount" } } },
            ])
            .toArray();
          const totalRevenue =
            revenueResult.length > 0 ? revenueResult[0].total : 0;

          // Chart Data: Revenue grouped by Date (Last 7 Days)
          const chartData = await paymentCollection
            .aggregate([
              { $match: { payment_status: "paid" } },
              {
                $group: {
                  _id: {
                    $dateToString: { format: "%Y-%m-%d", date: "$paidAt" },
                  },
                  Revenue: { $sum: "$amount" },
                },
              },
              { $sort: { _id: 1 } },
              { $limit: 7 },
            ])
            .toArray();

          const formattedChartData = chartData.map((data) => ({
            name: data._id,
            Revenue: data.Revenue,
          }));

          // --- NEW DATA FOR TABLES ---
          // Latest 5 parcels
          const recentParcels = await parcelCollection
            .find()
            .sort({ createdAt: -1 })
            .limit(5)
            .toArray();

          // Latest 5 successful payments
          const recentPayments = await paymentCollection
            .find({ payment_status: "paid" })
            .sort({ paidAt: -1 })
            .limit(5)
            .toArray();

          // Parcels needing rider assignment (Alerts)
          const actionRequired = await parcelCollection
            .find({ deliveryStatus: "awaiting_pickup" })
            .sort({ createdAt: -1 })
            .limit(4)
            .toArray();

          res.send({
            totalParcels,
            totalUsers,
            totalRiders,
            totalRevenue,
            chartData: formattedChartData,
            recentParcels,
            recentPayments,
            actionRequired,
          });
        } catch (error) {
          res
            .status(500)
            .send({ message: "Error fetching admin stats", error });
        }
      },
    );

    //* 2. Rider Dashboard Stats
    app.get("/rider-stats/:email", firebaseTokenVarify, async (req, res) => {
      const email = req.params.email;
      try {
        const deliveredCount = await parcelCollection.countDocuments({
          rider_email: email,
          deliveryStatus: "delivered",
        });
        const activeCount = await parcelCollection.countDocuments({
          rider_email: email,
          deliveryStatus: {
            $in: ["rider_assigned", "picked_up", "on-transit"],
          },
        });

        // Calculate Total Earnings (only from delivered parcels)
        const earningResult = await parcelCollection
          .aggregate([
            { $match: { rider_email: email, deliveryStatus: "delivered" } },
            { $group: { _id: null, total: { $sum: "$rider_earning" } } },
          ])
          .toArray();
        const totalEarnings =
          earningResult.length > 0 ? earningResult[0].total : 0;

        res.send({ deliveredCount, activeCount, totalEarnings });
      } catch (error) {
        res.status(500).send({ message: "Error fetching rider stats", error });
      }
    });

    //* 3. User Dashboard Stats
    app.get("/user-stats/:email", firebaseTokenVarify, async (req, res) => {
      const email = req.params.email;
      try {
        const totalSent = await parcelCollection.countDocuments({
          senderEmail: email,
        });
        const pendingCount = await parcelCollection.countDocuments({
          senderEmail: email,
          deliveryStatus: { $ne: "delivered" },
        });

        // Calculate Total Spent
        const spentResult = await paymentCollection
          .aggregate([
            { $match: { customer_email: email, payment_status: "paid" } },
            { $group: { _id: null, total: { $sum: "$amount" } } },
          ])
          .toArray();
        const totalSpent = spentResult.length > 0 ? spentResult[0].total : 0;

        res.send({ totalSent, pendingCount, totalSpent });
      } catch (error) {
        res.status(500).send({ message: "Error fetching user stats", error });
      }
    });

    //!================================  Reminder  -> Comment this Out when deploying to vercel ================================
    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

// =============== Listener  ============================
app.listen(port, () => {
  console.log(`ShipEx listening on port ${port}`);
});
