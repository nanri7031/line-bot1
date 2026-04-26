import express from "express"

const app = express()

app.use(express.json())

app.post("/webhook", (req, res) => {
  console.log("受信OK")
  res.sendStatus(200)
})

app.listen(process.env.PORT || 3000, () => {
  console.log("起動OK")
})
