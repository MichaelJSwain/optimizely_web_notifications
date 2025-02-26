const { default: axios } = require("axios");
require('dotenv').config();
const { OPTLY_TOKEN, TH_PROD_PROJECT_ID, TH_QA_AUDIENCE_ID } = process.env;

const db = {
    runningExperimentIDs: [5092054213066752, 5013064228012032, 4734509292191744, 4697687396712448],
    pausedExperimentIDs: [],
    archivedExperimentIDs: []
}

const fetchRunningTests = async () => {
    const options = {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: OPTLY_TOKEN
        }
      };
      
      const tests = await fetch(`https://api.optimizely.com/v2/search?per_page=50&page=1&query=-&project_id=${TH_PROD_PROJECT_ID}&type=experiment&expand=&archived=false&fullsearch=false&status=running`, options)
        .then(res => res.json())
        .then(res => {
            const exps = []
            res.forEach(exp => {
                const isTracked = db.runningExperimentIDs.some(id => id == exp.id);
                if (!isTracked) {
                    exps.push(exp);
                }
            });
            return exps;
        })
        .catch(err => console.error(err));
        return tests
}

const persistExp = (exp_id) => {
    db.runningExperimentIDs.push(exp_id);
}

const checkIsRunningForUsers = async (experiments) => {
    const runningTests = [];
    for (exp of experiments) {
        if (exp.id) {
            const options = {
                method: 'GET',
                headers: {
                  accept: 'application/json',
                  authorization: OPTLY_TOKEN
                }
              };
              
              const isRunning = await fetch(`https://api.optimizely.com/v2/experiments/${exp.id}`, options)
                .then(res => res.json())
                .then(res => {
                    if (!res.audience_conditions.includes(TH_QA_AUDIENCE_ID)) {
                        return true;
                    } else {
                        return false;
                    }
                })
                .catch(err => console.error(err));

                if (isRunning) {
                    runningTests.push(exp);
                    runningTests.push(isRunning);
                    persistExp(exp.id);
                }
                
        }

    }
    return runningTests;
}

const checkOptimizely = async () => {
    const runningTests = await fetchRunningTests(); 
    const runningForUsers = await checkIsRunningForUsers(runningTests);  
    console.log(runningForUsers);
}




// const hourInMilliseconds = 3600000;
const interval = 10000;
setInterval(() => {
//     console.log("checking Optly project");
    checkOptimizely()
}, interval);