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
const decoded = Buffer.from(process.env.FIREBASE_KEY, "base64").toString("utf8");
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
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
const firebaseTokenVarify = async(req,res,next)=>{
  if(!req.headers.authorization) {
    return res.status(401).send({ message: "Unauthorize Access !" });
  }
  const token = req.headers.authorization.split(" ")[1] ;
  // console.log(token) ;
  try {
    const userInfo = await admin.auth().verifyIdToken(token);
    req.token_email = userInfo.email;
    // console.log(userInfo) ;
    next();
  } catch {
    return res.status(401).send({ message: "Unauthorize Access ! " });
  }
}

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
    const userCollection = database.collection("users") ;
    const riderCollection = database.collection("riders") ;

    // *? ================================ MiddleWare to Varify Admin ==========================================
    const varifyAdmin = async(req,res,next) => {
      const email = req.token_email ;
      const query = {email} ;
      const user = await userCollection.findOne(query) ;
      if(!user || user.role !== 'admin'){
        return res.status(403).send({message: "Unauthorize Access ! "}) ;
      }
      next() ;
    }


   // *? ================================ Parcel Related APIs ==============================================
    //* ------------------- Api to get percel from Database ------------------------
    app.get("/parcel",firebaseTokenVarify ,async (req, res) => {
      const query = {};
      const email = req.query.email;
      if (email) {
        query.senderEmail = email;
      }
      const cursor = await parcelCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    //* ----------------------  APi to get Parcel By Id ----------------------
    app.get("/parcel/:id",firebaseTokenVarify,async (req, res) => {
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

    //* -------------------- Api to Add percel to Database ---------------------------
    app.post("/parcel", async (req, res) => {
      const newParcel = req.body;
      newParcel.createdAt = new Date();
      const result = await parcelCollection.insertOne(newParcel);
      res.send(result);
    });

    //* --------------- APi to get Payment history from db -----------------
    app.get('/payhistory',firebaseTokenVarify,async(req,res)=>{
      const query = {} ;
      const email = req.query.email ;
      // console.log(req) ;
      if(email){
        query.customer_email = email 
      }
      const cursor = await paymentCollection.find(query)
      const result = await cursor.toArray() ;
      res.send(result) ;
    })



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
      const tracking_id = generateTrackingId() ;

      //------------- Prevent Duplicate Payment Entry ------------------
      const transaction_id = session.payment_intent ;
      const query = {transaction_id : transaction_id} 
      const payment_exist = await paymentCollection.findOne(query) ;
      if(payment_exist){
        return  res.send({message : 'already Exist !!' , tracking_id : tracking_id ,
          transaction_id : payment_exist.transaction_id ,
          tracking_id : payment_exist.tracking_id
          })
      } 


      if (session.payment_status === "paid") {
        const parcel_id = session.metadata.parcel_id;
        const query = { _id: new ObjectId(parcel_id) };
        const update = {
          $set: {
            paymentStatus: "paid",
            tracking_id : tracking_id ,
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
          tracking_id : tracking_id ,
          payment_status: session.payment_status,
          paidAt: new Date(),
        };

        const newPayment = await paymentCollection.insertOne(payment) ;
        res.send({
          success : true ,
          modified_parce: result ,
          tracking_id : tracking_id ,
          transaction_id : session.payment_intent ,
          payment_info : newPayment , 
        });

        
      }
    });


    // *? ================================ User Related APis ==========================================
    // *-------------- api to save new user to database with role user -----------------------
    app.post("/users" ,async(req,res) => {
      const query = {} ;
      const userInfo = req.body ;
      const email = userInfo?.email ;
      if(email){
        query.email = email ;
      }
      const userExist = await userCollection.findOne(query) ;
      if(userExist){
        return res.send({message:"user already Exist !"}) ;
      }
      userInfo.createdAt = new Date() ;
      userInfo.role = 'user' ;
      const result = await userCollection.insertOne(userInfo) ;
      res.send(result) ;
    })

    // *-------------- api to get all the user from database-----------------------
    app.get('/users',async(req,res)=>{
      const searchedValue = req.query.searched ;
      const query = {} 
      if(searchedValue){
        query.$or = [
          {displayName : {$regex : searchedValue , $options : 'i'}} ,
          {name : {$regex : searchedValue , $options : 'i'}} ,
          {email : {$regex : searchedValue , $options : 'i'}}
        ]
      }
      const cursor = await userCollection.find(query) ;
      const result = await cursor.toArray();
      res.send(result) ;
    })
    

    // *-------------- api to get a the user by Role from database-----------------------
    app.get('/users/:email/role' , async(req,res)=>{
      const {email} = req.params ;
      const query = {email} ;
      const result = await userCollection.findOne(query) ;
      res.send({role : result?.role || 'user'})
    })

    // *-------------- api to get promote or Revoke a user to A Role-----------------------
    app.post('/users/:id' ,firebaseTokenVarify,varifyAdmin,async(req,res)=>{
      const user_id = req.params.id
      const {status} = req.body ;
      const query = {_id : new ObjectId(user_id)}
      const update = {
        $set : {
          role : status
        }
      }
      const result = await userCollection.updateOne(query,update) ;
      res.send(result) ;
    })


    // *-------------- api to save new Rider Request to database -----------------------
    app.post('/riders' , async(req,res)=>{
      const riderInfo = req.body ;
      const query = {} ;
      const email = riderInfo.email ;
      riderInfo.createdAt = new Date() ;
      riderInfo.status = "pending" ;
      if(email){
        query.email = email ;
      }
      const existingRider = await riderCollection.findOne(query) ;
      if(existingRider){
        return res.send({message : "Rider Already Exist !"})
      }
      const result = await riderCollection.insertOne(riderInfo) ;
      res.send(result) ;
    })

    // *-------------- api to get all the Rider from database -----------------------
    app.get('/riders' ,firebaseTokenVarify ,async(req,res)=>{
      const query = {} ;
      const cursor = await riderCollection.find(query)
      const result = await cursor.toArray() ;
      res.send(result) ;
    })

    // *-------------- api to get a Rider from database by Specific id-----------------------
    app.get('/riders/:id' , firebaseTokenVarify,async(req,res)=>{
      const rider_id = req.params.id ;
      const query = {_id : new ObjectId(rider_id)} ;
      const result = await riderCollection.findOne(query) ;
      res.send(result) ;
    })
    // *-------------- api to Approve OR Reject a Rider Application by Specific id-----------------------
    app.post('/riders/:id' , firebaseTokenVarify,varifyAdmin,async(req,res)=>{
      const rider_id = req.params.id ;
      const user_email = req.body.email ;
      const status = req.body.status ;
      const query = {_id : new ObjectId(rider_id)}
      const updateFields = {
        $set : {
          status : status
        }
      }
      const result = await riderCollection.updateOne(query,updateFields)
      if(status ==="approved"){
        const roleQuery = {email : user_email}
        const roleUpdate = {
          $set : {
            role : 'rider'
          }
        }
        const result = await userCollection.updateOne(roleQuery,roleUpdate)
      }
      res.send(result) ;
    })

    

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
