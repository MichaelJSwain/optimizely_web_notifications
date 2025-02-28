require('dotenv').config();
const {OPTLY_TOKEN, TH_QA_AUDIENCE_ID} = process.env;

const optimizelyRequest = async (endpoint, method, body = false) => {
    const options = {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: OPTLY_TOKEN
        }
      };
      
      const result = await fetch(endpoint, options)
        .then(res => res.json())
        .then(res => res)
        .catch(err => console.error(err));
      return result;
}

const getTimestamps = () => {
    const endTimestamp = Date.now();
    const startTimestamp = Date.now() - 9600000;

    const endTimestampISO = new Date(endTimestamp).toISOString();
    const startTimestampISO = new Date(startTimestamp).toISOString();

    return {
        start_time: startTimestampISO,
        end_time: endTimestampISO
    }
}

const checkForUpdatedExperimentStatus = (changeHistory) => {
    const experimentIDs = {};

    // changeHistory.forEach(item => {
    //     console.log(item);
    // })

    for (item of changeHistory) {
        if (item.changes) {
            for (change of item.changes) {
                if (change.property && change.property === "status" && !experimentIDs[item.entity.id]) {
                    
                    experimentIDs[item.entity.id] = {
                        exp_id: item.entity.id,
                        exp_name: item.entity.name,
                        exp_status: change.after
                    }
                }
            }
        }
    }
    return experimentIDs;
}

const checkChangeHistory = async () => {
    const {start_time, end_time} = getTimestamps();
    const changeHistory = await optimizelyRequest(`https://api.optimizely.com/v2/changes?project_id=26081140005&start_time=${start_time}&end_time=${end_time}&per_page=25&page=1`)
    return changeHistory; 
}

const checkTargeting = async (updatedExperiments) => {
    const launchedExperiments = [];
    const keys = Object.keys(updatedExperiments);

    for (const key of keys) {
        console.log(key);
        const foundExperiment = await optimizelyRequest(`https://api.optimizely.com/v2/experiments/${updatedExperiments[key].exp_id}`);
        let isRunningInQAMode;
        if (foundExperiment) {
            isRunningInQAMode = false;
            if (!foundExperiment.audience_conditions.includes(TH_QA_AUDIENCE_ID) || 
                (!foundExperiment.audience_conditions.includes("and") && 
                foundExperiment.audience_conditions.includes(TH_QA_AUDIENCE_ID))) {
                
                // check page targeting too
                if (foundExperiment.page_ids.length) {
                    const page_id = foundExperiment.page_ids[0];
                    const foundPage = await optimizelyRequest(`https://api.optimizely.com/v2/pages/${page_id}`);
                    if (foundPage && foundPage.conditions && foundPage.conditions.includes("devtestp")) {
                        isRunningInQAMode = true;
                    } else {
                        isRunningInQAMode = false;
                    }
                }
            } else {
                isRunningInQAMode = true;
            }

            if (!isRunningInQAMode) {
                launchedExperiments.push(updatedExperiments[key]);
            }
        }
    }
    return launchedExperiments;
}

const main = async () => {
    const changeHistory = await checkChangeHistory();
    if (changeHistory.length) {
        const updatedExperiments = checkForUpdatedExperimentStatus(changeHistory);
        if (updatedExperiments) {
            const result = await checkTargeting(updatedExperiments);
            console.log(result);
        }
    }
}
main();