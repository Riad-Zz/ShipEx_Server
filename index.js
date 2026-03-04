// ============================= Required ===============================
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

// =============== Initial Ports and Connections =============================
const app = express();
const port = process.env.PORT || 3000;

// ====================== MiddleWire ===================================
app.use(cors());
app.use(express.json());

// ============================ Test Api ===================================
app.get("/", (req, res) => {
  res.send("ShipEx is Running !");
});

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
    await client.connect();

    // ========================== Databases & all Collection here ======================================
    const database = client.db("ShipEx") ;
    const parcelCollection = database.collection("percels") ;


    // ===================== Parcel Related API ================================

    // ------------------- Api to get percel from Database ------------------------
    app.get('/parcel',async(req,res)=>{
        const query = {} ;
        const email = req.query.email ;
        if(email){
            query.senderEmail = email ;
        }
        const cursor = await parcelCollection.find(query) ;
        const result = await cursor.toArray() ;
        res.send(result) ;
    }) 

    // ----------------------  APi to get Parcel By Id ----------------------
    app.get('/parcel/:id' , async(req,res)=>{
      const parcel_id = req.params.id ;
      const query = {_id : new ObjectId(parcel_id)} ;
      const result =await parcelCollection.findOne(query)
      res.send(result) ;
    })

    
    // -------------------- Api to Add percel to Database --------------------------- 
    app.post('/parcel',async(req,res)=>{
        const newParcel = req.body ;
        newParcel.createdAt = new Date() ;
        const result =await parcelCollection.insertOne(newParcel) ;
        res.send(result) ;
    })


    //----------------------- Reminder  -> Comment this Out when deploying to vercel -------------------
    await client.db("admin").command({ ping: 1 });
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
