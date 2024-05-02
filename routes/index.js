const router = require("express").Router();
router.use("/users", require("./users"));
router.use("/", require("./routes"));
router.use("/auditos", require("./auditos"));
module.exports = router;