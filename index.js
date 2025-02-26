const { default: axios } = require("axios");
require('dotenv').config();
const { OPTLY_TOKEN } = process.env;




// const hourInMilliseconds = 3600000;
const interval = 10000;
setInterval(() => {
    console.log("checking Optly project");
}, interval);