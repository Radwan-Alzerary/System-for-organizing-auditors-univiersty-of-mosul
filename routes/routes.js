const MainScreenView = require("../model/mainScreenView");

const router = require("express").Router();

router.get("/", async (req, res) => {
  const systemScreen = await MainScreenView.findOne();
  res.render("them3",{systemScreen});
});

module.exports = router;
