const { default: axios } = require("axios");
const express = require("express");
const app = express();
const { response } = require("express");
require('dotenv').config();
const {OPTLY_TOKEN, PORT, TH_QA_QA_AUDIENCE_ID, CK_QA_QA_AUDIENCE_ID, TH_QA_PROJECT_ID, CK_QA_PROJECT_ID, TEAMS_QA_CHANNEL_ENDPOINT, TEAMS_CHANNEL_ENDPOINT} = process.env;

const optimizelyRequest = async (endpoint) => {
    const options = {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: OPTLY_TOKEN
        }
      };
      
      const response = await fetch(endpoint, options)
        .then(res => res.json())
        .then(res => res)
        .catch(err => {
            console.log("⚠️ Optimizely request error: ", err.message);
            return false;
        });
      return response;
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

const getProjectsIDs = () => {
    const projectIDs = [TH_QA_PROJECT_ID, CK_QA_PROJECT_ID]
    return projectIDs;
}

const checkForUpdatedExperimentStatus = (project_id, changeHistory) => {
    console.log(`⚙️ Checking if experiment status was changed... `);
    const experimentIDs = {};

    for (item of changeHistory) {
        if (item.changes) {
            for (change of item.changes) {
                if (change.property && change.property === "status" && !experimentIDs[item.entity.id]) {
                    
                    experimentIDs[item.entity.id] = {
                        exp_id: item.entity.id,
                        exp_name: item.entity.name,
                        exp_status: change.after,
                        project: project_id == TH_QA_PROJECT_ID ? "TH" : "CK"
                    }
                }
            }
        }
    }
    return experimentIDs;
}

const checkChangeHistory = async (project_id, start_time, end_time) => {
    console.log(`⚙️ Checking project change history ${end_time}...`);
    const endpoint = `https://api.optimizely.com/v2/changes?project_id=${project_id}&start_time=${start_time}&end_time=${end_time}&per_page=25&page=1`;
    const changeHistory = await optimizelyRequest(endpoint);
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
    console.log(`⚙️ Checking if launched experiment / targets real users...`);
    const launchedExperiments = [];
    const experimentKeys = Object.keys(updatedExperiments);

    for (const key of experimentKeys) {
        const endpoint = `https://api.optimizely.com/v2/experiments/${updatedExperiments[key].exp_id}`;
        const foundExperiment = await optimizelyRequest(endpoint);
        let isRunningInQAMode;
        if (foundExperiment) {

            const isEqualTrafficAllocation = checkTrafficAllocation(10000, foundExperiment.variations);
            updatedExperiments[key].isEqualTrafficAllocation = isEqualTrafficAllocation;

            const foundCustomGoals = checkCustomGoals(foundExperiment);
            updatedExperiments[key].hasCustomGoals = foundCustomGoals;

            isRunningInQAMode = false;
            if (!foundExperiment.audience_conditions.includes(project_id == TH_QA_QA_AUDIENCE_ID ? TH_QA_QA_AUDIENCE_ID : CK_QA_QA_AUDIENCE_ID) || 
                (!foundExperiment.audience_conditions.includes("and") && 
                foundExperiment.audience_conditions.includes(project_id == TH_QA_QA_AUDIENCE_ID ? TH_QA_QA_AUDIENCE_ID : CK_QA_QA_AUDIENCE_ID))) {
                
                // check if targeting prod / lower env in page conditions
                if (foundExperiment.page_ids.length) {
                    const page_id = foundExperiment.page_ids[0];
                    const endpoint = `https://api.optimizely.com/v2/pages/${page_id}`;
                    const foundPage = await optimizelyRequest(endpoint);
                    if (foundPage && foundPage.conditions && foundPage.conditions.includes("devtest")) {
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
    const startTimeParsed = `${new Date(start_time).toString().split("GMT")[0]} CET`;
    const endTimeParsed = `${new Date(end_time).toString().split("GMT")[0]} CET`;

    let message = [
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
                text: `${startTimeParsed} - ${endTimeParsed}`,
                weight: "bolder",
                size: "small"
              },
              {
                'type': 'TextBlock',
                'text': ' ',
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
                'text': ' ',
                'separator': true,
                'isSubtle': true,
                'size': 'small'
            }
            ]
          }
          message.push(factSet);
        })
    return message;
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
        console.log(`✅ Notification successfully sent`);
    })
    .catch(function (error) {
        console.log(`⚠️ Unable to send notification: ${error.message}`);
    });
}

const checkWebProjects = async () => {
    const {start_time, end_time} = getTimestamps();
    const project_ids = getProjectsIDs();
    let result = [];
    let notificationMessage;

    for (project_id of project_ids) {
        const changeHistory = await checkChangeHistory(project_id, start_time, end_time);
        if (changeHistory) {
            if (changeHistory.length) {
                const updatedExperiments = checkForUpdatedExperimentStatus(project_id, changeHistory);
                
                if (updatedExperiments) {
                    const launchedExperiments = await checkTargeting(project_id, updatedExperiments);
                    if (launchedExperiments.length) {
                        result = [...result, ...launchedExperiments];
                    }
                }
            } else {
                console.log(`ℹ️ There were no important changes made to the project: ${project_id} between ${start_time} - ${end_time}`);
            }
        }
    }
    if (result.length) {
        console.log("⚙️ Building notification message... ");
        notificationMessage = buildNotificationMessage(result, start_time, end_time);
        sendNotification(notificationMessage);
    } else {
        console.log("ℹ️ No experiments in production")
    }
}

// const main = () => {
//     const oneHourInterval = 30000;
//     setInterval(() => {
//         checkWebProjects();
//     }, oneHourInterval);
// }
// main();

app.get("/pvh/optimizelyWeb/notifications", (req, res) => {
    console.log("request received from cron job");
    checkWebProjects();
});

app.listen(PORT, (req, res) => {
    console.log("app listening...");
})