const router = require("express").Router();
router.use("/users", require("./users"));
router.use("/", require("./routes"));
router.use("/auditos", require("./auditos"));
router.use("/screen", require("./mainScreenView"));
router.use("/themes", require("./themeRoutes"));
router.use("/department", require("./department"));
router.use("/system", require("./systemSetting"));
module.exports = router;