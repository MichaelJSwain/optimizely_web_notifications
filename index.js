const { default: axios } = require("axios");
require('dotenv').config();
const {OPTLY_TOKEN, TH_QA_QA_AUDIENCE_ID, TH_QA_PROJECT_ID, TEAMS_QA_CHANNEL_ENDPOINT} = process.env;

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
    const startTimestamp = Date.now() - 3600000;

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

const checkChangeHistory = async (start_time, end_time) => {
    const changeHistory = await optimizelyRequest(`https://api.optimizely.com/v2/changes?project_id=${TH_QA_PROJECT_ID}&start_time=${start_time}&end_time=${end_time}&per_page=25&page=1`)
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
            if (!foundExperiment.audience_conditions.includes(TH_QA_QA_AUDIENCE_ID) || 
                (!foundExperiment.audience_conditions.includes("and") && 
                foundExperiment.audience_conditions.includes(TH_QA_QA_AUDIENCE_ID))) {
                
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

const buildNotificationMessage = (experimentChanges, start_time, end_time) => {
    let message = 'Update(s) to Optimizely Web (client-side) experiments:'
    let message2 = [
        {
        type: "Container",
        items: [
            {
                type: "TextBlock",
                text: "Optimizely client-side updates",
                weight: "bolder",
                size: "Large"
            },
            {
                type: "TextBlock",
                text: `${start_time} - ${end_time}`,
                weight: "bolder",
                size: "small"
              }
        ]
        },  

        ];

    experimentChanges.forEach(change => {
        const factSet = {
            type: "Container",
            items: [
              {
                type: "FactSet",
                facts: [
                  {
                    title: "Experiment name:",
                    value: `${change.exp_name}`
                  },
                  {
                    title: "Status:",
                    value: `${change.exp_status}`
                  }
                ]
              }
            ]
          }
          message2.push(factSet);
        })
    // const jsonMessage = JSON.stringify(message2);
    return message2;
}

const sendNotification = (message) => {
    const reqbody = {
        "type":"message",
        "attachments":[
           {
              "contentType":"application/vnd.microsoft.card.adaptive",
              "contentUrl":null,
              "content":{
                 "$schema":"http://adaptivecards.io/schemas/adaptive-card.json",
                 "type":"AdaptiveCard",
                 "version":"1.4",
                 "body": message
                 
              }
           }
        ]
     };
     axios.post(TEAMS_QA_CHANNEL_ENDPOINT, reqbody)
    .then(function (response) {
        console.log(response);
    })
    .catch(function (error) {
        console.log(error);
    });
}

const main = async () => {
    const {start_time, end_time} = getTimestamps();
    const changeHistory = await checkChangeHistory(start_time, end_time);
    if (changeHistory.length) {
        const updatedExperiments = checkForUpdatedExperimentStatus(changeHistory);
        if (updatedExperiments) {
            const result = await checkTargeting(updatedExperiments);
            const notificationMessage = buildNotificationMessage(result, start_time, end_time);
            // console.log(notificationMessage);
            sendNotification(notificationMessage);
        }
    } else {
        console.log("no changes made in the last hour");
    }
}
main();


// for (let i = 0; i < 5; i++) {
//     const factset = {
//         "type": "Container",
//         "items": [
//           {
//             "type": "FactSet",
//             "facts": [
//               {
//                 "title": "Experiment name:",
//                 "value": "exp2"
//               },
//               {
//                 "title": "Status:",
//                 "value": "paused"
//               },
//               {
//                 "title": "Project",
//                 "value": "TH"
//               }
//             ]
//           }
//         ]
//       }
      
// }