const router = require('express').Router();

router.get('/', async (req, res) => {
  res.send("hello")
})


module.exports = router;
