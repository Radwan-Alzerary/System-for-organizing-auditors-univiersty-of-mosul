const authenticateToken = require("../middlewares/authenticateToken");

const router = require("express").Router();
router.use("/users", require("./users"));
router.use("/", require("./routes"));
router.use("/auditos",authenticateToken, require("./auditos"));
router.use("/department", require("./department"));
router.use("/customer", require("./customer"));
router.use("/financial",authenticateToken, require("./financial"));
router.use("/driver", require("./driver"));
router.use("/system",authenticateToken, require("./systemSetting"));
router.use("/ride",authenticateToken, require("./ride"));
router.use("/places",authenticateToken, require("./places"));
module.exports = router;