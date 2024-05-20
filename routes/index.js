const router = require("express").Router();
router.use("/users", require("./users"));
router.use("/", require("./routes"));
router.use("/auditos", require("./auditos"));
router.use("/department", require("./department"));
module.exports = router;