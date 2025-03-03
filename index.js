const { default: axios } = require("axios");
const { response } = require("express");
require('dotenv').config();
const {OPTLY_TOKEN, TH_QA_QA_AUDIENCE_ID, CK_QA_QA_AUDIENCE_ID, TH_QA_PROJECT_ID, CK_QA_PROJECT_ID, TEAMS_QA_CHANNEL_ENDPOINT} = process.env;

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

const getProjects = () => {
    return [TH_QA_PROJECT_ID, CK_QA_PROJECT_ID]
}

const checkForUpdatedExperimentStatus = (project_id, changeHistory) => {
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
                        exp_status: change.after,
                        project: project_id == 14193350179 ? "TH" : "CK"
                    }
                }
            }
        }
    }
    return experimentIDs;
}

const checkChangeHistory = async (project_id, start_time, end_time) => {
    const changeHistory = await optimizelyRequest(`https://api.optimizely.com/v2/changes?project_id=${project_id}&start_time=${start_time}&end_time=${end_time}&per_page=25&page=1`)
    return changeHistory; 
}

const checkTrafficAllocation = (totalTrafficAllocation = 10000, variants) => {
    // calculate equal per variant allocation for equal traffic
    const splitPerVariant = Math.trunc(totalTrafficAllocation / variants.length);
    
    let remainder;
    if (splitPerVariant * variants.length == totalTrafficAllocation) {
        remainder = false;
    } else {
        remainder = totalTrafficAllocation - (splitPerVariant * (variants.length - 1));
    }
    
    const trafficAllocation = remainder ? [splitPerVariant, remainder] : [splitPerVariant];
    
    const isEqual = variants.every(v => {
        if (v.weight == trafficAllocation[0] || v.weight == trafficAllocation[1]) {
            return true;
        } else {
            return false;
        }
    });
    return isEqual;
}

const checkCustomGoals = (experiment) => {
    
    let customGoalsShared = false;
    let customGoalsVariant = false;

    
    // check for call to optimizely.sendAnalyticsEvents in the shared code
    if (experiment.changes) {
        // const sharedJS = experiment.changes.some(c => c.type === "custom_code");
        const sharedJS = experiment.changes.find(c => c.type === "custom_code");
        
        if (sharedJS && sharedJS.value.includes("optimizely.sendAnalyticsEvents")) {
            customGoalsShared = true;
        }
    }

    // check for call to optimizely.sendAnalyticsEvents in the variant code
    if (experiment.variations) {
        experiment.variations.forEach(variation => {
            if (variation.actions && variation.actions.length) {
                variation.actions.forEach(action => {
                    action.changes.find(change => {
                        if (change.type === "custom_code" && change.value.includes("optimizely.sendAnalyticsEvents")) {
                            customGoalsVariant = true;
                        }
                    })
                })
            }
        });
    }

    return customGoalsShared || customGoalsVariant ? true : false;
}

const checkTargeting = async (project_id, updatedExperiments) => {
    const launchedExperiments = [];
    const keys = Object.keys(updatedExperiments);

    for (const key of keys) {
        const foundExperiment = await optimizelyRequest(`https://api.optimizely.com/v2/experiments/${updatedExperiments[key].exp_id}`);
        let isRunningInQAMode;
        if (foundExperiment) {

            const isEqualTrafficAllocation = checkTrafficAllocation(10000, foundExperiment.variations);
            updatedExperiments[key].isEqualTrafficAllocation = isEqualTrafficAllocation;

            const foundCustomGoals = checkCustomGoals(foundExperiment);
            updatedExperiments[key].hasCustomGoals = foundCustomGoals;

            isRunningInQAMode = false;
            if (!foundExperiment.audience_conditions.includes(project_id == 14193350179 ? TH_QA_QA_AUDIENCE_ID : CK_QA_QA_AUDIENCE_ID) || 
                (!foundExperiment.audience_conditions.includes("and") && 
                foundExperiment.audience_conditions.includes(project_id == 14193350179 ? TH_QA_QA_AUDIENCE_ID : CK_QA_QA_AUDIENCE_ID))) {
                
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
              },
              {
                'type': 'TextBlock',
                'separator': true,
                'isSubtle': true,
                'size': 'small'
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
                  },
                  {
                    title: "Equal traffic allocation:",
                    value: change.isEqualTrafficAllocation ? change.isEqualTrafficAllocation :`⚠️ ${change.isEqualTrafficAllocation}`
                },
                {
                    title: "Custom goals found:",
                    value: change.hasCustomGoals ? change.hasCustomGoals :`⚠️ ${change.hasCustomGoals}`
                },
                  {
                    title: "Project:",
                    value: `${change.project}`
                  }
                ]
              },
              {
                'type': 'TextBlock',
                'separator': true,
                'isSubtle': true,
                'size': 'small'
            }
            ]
          }
          message2.push(factSet);
        })
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
    const project_ids = getProjects();
    let result = [];
    let notificationMessage;

    for (project_id of project_ids) {
        const changeHistory = await checkChangeHistory(project_id, start_time, end_time);
        if (changeHistory.length) {
            const updatedExperiments = checkForUpdatedExperimentStatus(project_id, changeHistory);
            
            if (updatedExperiments) {
                const response = await checkTargeting(project_id, updatedExperiments);
                if (response.length) {
                    result = [...result, ...response];
                }
                // const notificationMessage = buildNotificationMessage(result, start_time, end_time);
                // console.log(notificationMessage);
                // sendNotification(notificationMessage);
            }
        } else {
            console.log("no changes made in the last hour");
        }
    }
    if (result.length) {
        console.log("building notification message");
        notificationMessage = buildNotificationMessage(result, start_time, end_time);
        // console.log(notificationMessage[1].items[0].facts);
        // console.log(notificationMessage[2].items[0].facts);
        // console.log(notificationMessage[3].items[0].facts);
    } else {
        console.log("no experiments in production")
    }
    
    sendNotification(notificationMessage);
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