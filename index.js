// ============================= Required ===============================
require("dotenv").config(); 
const express = require('express')
const cors = require('cors') 

// =============== Initial Ports and Connections ============================= 
const app = express()
const port = process.env.PORT || 3000

// ====================== MiddleWire =================================== 
app.use(cors()) ;
app.use(express.json()) ;

// ============================ Test Api ===================================
app.get('/', (req, res) => {
  res.send('ShipEx is Running !')
})

// =============== Listener  ============================
app.listen(port, () => {
  console.log(`ShipEx listening on port ${port}`)
})