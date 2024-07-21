const router = require("express").Router();
router.use("/users", require("./users"));
router.use("/", require("./routes"));
router.use("/auditos", require("./auditos"));
router.use("/department", require("./department"));
router.use("/system", require("./systemSetting"));
module.exports = router;