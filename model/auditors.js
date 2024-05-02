const mongoose = require("mongoose");
const AuditorsSchema = new mongoose.Schema(
  {
    name: { type: String },
    from:{type:String},
    to:{type:String},
    state:{type:String},
    sequence:{type:Number,default:1},
    expire :{type:Date}
    
  },
  {
    timestamps: true,
  }
);
const Auditors = mongoose.model("Auditors", AuditorsSchema);

module.exports = Auditors;
