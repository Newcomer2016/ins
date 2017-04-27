let process = require('process');
let path = require('path');
let fs = require('fs');

let winston = require('winston');
let mapLimit = require('async/mapLimit');
let request = require('request');
let cheerio = require('cheerio');

let config;
if (fs.existsSync('./config.my.js')) {
    config = require('./config.my');
} else {
    config = require('./config');
}

Date.prototype.Format = function (fmt) {
    let o = {
        'M+': this.getMonth() + 1, //月份
        'd+': this.getDate(), //日
        'h+': this.getHours() % 12 == 0 ? 12 : this.getHours() % 12, //小时
        'H+': this.getHours(), //小时
        'm+': this.getMinutes(), //分
        's+': this.getSeconds(), //秒
        'q+': Math.floor((this.getMonth() + 3) / 3), //季度
        'S': this.getMilliseconds() //毫秒
    };
    let week = {
        '0': '/u65e5',
        '1': '/u4e00',
        '2': '/u4e8c',
        '3': '/u4e09',
        '4': '/u56db',
        '5': '/u4e94',
        '6': '/u516d'
    };
    if (/(y+)/.test(fmt)) {
        fmt = fmt.replace(RegExp.$1, (this.getFullYear() + '').substr(4 - RegExp.$1.length));
    }
    if (/(E+)/.test(fmt)) {
        fmt = fmt.replace(RegExp.$1, ((RegExp.$1.length > 1) ? (RegExp.$1.length > 2 ? '/u661f/u671f' : '/u5468') : '') + week[this.getDay() + '']);
    }
    for (let k in o) {
        if (new RegExp('(' + k + ')').test(fmt)) {
            fmt = fmt.replace(RegExp.$1, (RegExp.$1.length == 1) ? (o[k]) : (('00' + o[k]).substr(('' + o[k]).length)));
        }
    }
    return fmt;
};

function creatSavePath(dirPath, mode) {
    if (!fs.existsSync(dirPath)) {
        let pathTmp;
        dirPath.split(path.sep).forEach(function (dirName) {
            if (pathTmp) {
                pathTmp = path.join(pathTmp, dirName);
            } else {
                pathTmp = dirName;
            }
            if (!fs.existsSync(pathTmp)) {
                if (!fs.mkdirSync(pathTmp, mode)) {
                    return false;
                }

            }
        });
    }
    return true;
}

// function fullChar2halfChar(str) {
//     var result = '';
//     for (let i = 0; i < str.length; i++) {
//         let code = str.charCodeAt(i); // 获取当前字符的unicode编码
//         if (code >= 65281 && code <= 65373) // 在这个unicode编码范围中的是所有的英文字母已经各种字符
//         {
//             // 把全角字符的unicode编码转换为对应半角字符的unicode码 (除空格)
//             result += String.fromCharCode(str.charCodeAt(i) - 65248);
//         } else if (code == 12288) { // 空格
//             result += String.fromCharCode(str.charCodeAt(i) - 12288 + 32);
//         } else {
//             result += str.charAt(i);
//         }
//     }
//     return result;
// }

// function fileNameDelIllegalChar(fileName) {
//     if (fileName) {
//         fileName = fullChar2halfChar(fileName.toString());
//         let illegalChar = {
//             '\n': '  ', //   \n
//             '\\\\': '-', //   \
//             '/': '-', //   /
//             '\\:': '-', //   :
//             '\\*': '.', //   *
//             '\\?': '', //   ?
//             '"': ' ', //   ""
//             '<': '[', //   <
//             '>': ']', //   >
//             '\\|': '-' //   |
//         };
//         for (let i in illegalChar) {
//             fileName = fileName.replace(new RegExp(i, 'g'), illegalChar[i]);
//         }
//         return fileName;
//     }
// }

const hostUrl = 'https://www.instagram.com/';
const defUserOccurs = 3;
config.maxUserOccurs = config.maxUserOccurs || defUserOccurs;
const defMediaOccurs = 24;
config.maxMediaOccurs = config.maxMediaOccurs || defMediaOccurs;
const defTimeout = 10000;

let j = request.jar();
if (config.sessionCookie) {
    var cookie = request.cookie(`sessionid=${config.sessionCookie}`);
    j.setCookie(cookie, hostUrl);
}

let r = request.defaults({
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/55.0.2883.103 Safari/537.36'
    },
    gzip: true,
    timeout: parseInt(config.timeout) || defTimeout,
    proxy: config.proxy,
    jar: j,
    rejectUnauthorized: config.igrCAErr === true ? false : true
});


function init() {
    let downUsers;
    let endErr;
    let endResult;

    if (process.argv.length > 2) {
        downUsers = process.argv.slice(2);
    } else {
        downUsers = config.downUsers;
    }

    if (!downUsers || downUsers.length === 0) {
        winston.error('not find any users.');
        return false;
    }

    downUsers.filter(function (value, index, array) {
        if (/^(?:https?:\/\/(?:www\.)?instagram\.com\/)?([\w\d_\.]+)\/?$/.test(value)) {
            array[index] = RegExp.$1;
            return true;
        } else {
            winston.warn(`${value} not a true username.`);
            return false;
        }
    });
    winston.info(`down users is ( ${downUsers.join(' | ')} ).`, '\n');

    mapLimit(downUsers, config.maxUserOccurs, function (downUser, callback) {
        getDownUserInfo(downUser, callback);
    }, function (err, result) {
        endErr = err;
        endResult = result;
    });

    process.on('exit', () => {
        winston.info(`***   ${endResult.length} users end the task   ***\n`);
        let downMediaCount = 0;
        endResult.forEach(function (count) {
            winston.info(`  ${count.userName}  down    img  ${count.downImg}  video  ${count.downVideo}`);
            winston.info(`  ${count.userName}  existed img  ${count.existedImg}  video  ${count.existedVideo}`);
            winston.info(`  ${count.userName}  deal with media  ${count.dealMedia}/${count.countMedia}\n\n`);
            downMediaCount = downMediaCount + count.downImg + count.downVideo;
        });
        winston.info(`***   ${endResult.length} users have down  ${downMediaCount}  media   ***`);

        if (endErr) {
            winston.error(endErr);
        }
    });
}

function getDownUserInfo(downUser, callback) {
    let userDB = {
        logF: undefined,
        csrfToken: undefined,
        id: undefined,
        userName: downUser,
        savePath: path.join(config.savePath || './', downUser),
        media: {
            count: undefined,
            nodes: [],
            page_info: {
                has_next_page: undefined,
                end_cursor: undefined
            }
        }
    };

    if (!creatSavePath(path.join(userDB.savePath, 'log'))) {
        winston.error(`creat ${userDB.savePath} path fail !`);
        callback(userDB.savePath);
        return false;
    }

    let logFilePath = path.join(userDB.savePath, './log/' + new Date().Format('yyyy-MM-dd HH.mm.ss') + '.log.json');
    winston.info(`  ${userDB.userName}  log file in ${logFilePath}`);
    userDB.logF = new(winston.Logger)({
        debug: config.debug === true ? true : false,
        transports: [
            new(winston.transports.Console)(),
            new(winston.transports.File)({
                filename: logFilePath
            })
        ]
    });

    r.get(hostUrl + downUser + '/', function (err, resp) {
        if (err) {
            let theErr = `  ${userDB.userName}  get user info fail.\n ${err}`;
            userDB.logF.error(theErr);
            callback(theErr);
            return false;
        }

        let $ = cheerio.load(resp.body);
        $('script').each(function (index, element) {
            if ($(element).text() && /^window\._sharedData = (\{.*\});$/.test($(element).text())) {
                let downUserInfo = JSON.parse(RegExp.$1);
                if (downUserInfo.entry_data.ProfilePage) {
                    userDB.id = downUserInfo.entry_data.ProfilePage[0].user.id;
                    userDB.userName = downUserInfo.entry_data.ProfilePage[0].user.username;
                    userDB.media = downUserInfo.entry_data.ProfilePage[0].user.media;
                    userDB.media.nodes = [];
                }
            }
        });

        if (!userDB.id) {
            let theErr = `  ${userDB.userName}  the resp.body not have user info.`;
            userDB.logF.error(theErr);
            callback(theErr);
            return false;
        }

        if (!userDB.csrfToken) {
            let cookies = j.getCookies(hostUrl);
            for (let element of cookies) {
                if (element.key === 'csrftoken') {
                    userDB.csrfToken = element.value;
                }
            }
            if (!userDB.csrfToken) {
                let theErr = `  ${userDB.userName}  not get the csrftoken cookie.`;
                userDB.logF.error(theErr);
                callback(theErr);
                return false;
            }
        }

        userDB.logF.info(`  ${userDB.userName}  csrftoken is  ${userDB.csrfToken}  .\n`);
        userDB.logF.info(`  ${userDB.userName}  have  ${userDB.media.count}  media. start download media info downing.\n`);

        getMediaNodeList(userDB, callback);

    });
}


function getMediaNodeList(userDB, callback) {
    let onePageNodes = 12;
    if (userDB.media.page_info.has_next_page) {
        r.post({
            url: hostUrl + 'query' + '/',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': '*/*',
                'X-CSRFToken': userDB.csrfToken,
                'Referer': hostUrl + userDB.userName + '/',
                // 'Accept-Encoding': 'gzip, deflate, br'
            },
            body: `q=ig_user(${userDB.id})+%7B+media.after(${userDB.media.page_info.end_cursor}%2C+${onePageNodes})+%7B%0A++count%2C%0A++nodes+%7B%0A++++caption%2C%0A++++code%2C%0A++++comments+%7B%0A++++++count%0A++++%7D%2C%0A++++comments_disabled%2C%0A++++date%2C%0A++++dimensions+%7B%0A++++++height%2C%0A++++++width%0A++++%7D%2C%0A++++display_src%2C%0A++++id%2C%0A++++is_video%2C%0A++++likes+%7B%0A++++++count%0A++++%7D%2C%0A++++owner+%7B%0A++++++id%0A++++%7D%2C%0A++++thumbnail_src%2C%0A++++video_views%0A++%7D%2C%0A++page_info%0A%7D%0A+%7D`
        }, function (err, resp, body) {
            if (err) {
                let theErr = `  ${userDB.userName}  get media info fail.\n ${err}`;
                userDB.logF.error(theErr);
                callback(theErr);
                return false;
            }
            if (resp.statusCode !== 200) {
                userDB.logF.warn(`  ${userDB.userName}  get  ${userDB.media.nodes.length}/${userDB.media.count}  media info the status code is  ${resp.statusCode}\n try again`);
            } else {
                let nextData = JSON.parse(body);
                if (nextData.status === 'ok') {
                    userDB.media.nodes.push(...nextData.media.nodes);
                    userDB.media.page_info = nextData.media.page_info;
                    userDB.logF.info(`  ${userDB.userName}  have get  ${userDB.media.nodes.length}/${userDB.media.count}  media info.`);
                } else {
                    let theErr = `  ${userDB.userName}  get  ${userDB.media.nodes.length}/${userDB.media.count}  media info the resp.json not ok.\n the jsonData is :\n  ${nextData}`;
                    userDB.logF.error(theErr);
                    callback(theErr);
                    return false;
                }
            }

            getMediaNodeList(userDB, callback);
        });
    } else {
        userDB.logF.info(`  ${userDB.userName}  have get  ${userDB.media.nodes.length}/${userDB.media.count}  media info successful.\n`);
        userDB.logF.info(`  ${userDB.userName}  media node downloading. Please wait ...\n`);
        downMediaList(userDB, callback);
    }
}

function downMediaList(userDB, callback) {
    let mediaNodeList = userDB.media.nodes;

    mapLimit(mediaNodeList, config.maxMediaOccurs, function (mediaNodeInfo, callback2) {
        if (mediaNodeInfo.is_video) {
            let videoJsonUrl = `${hostUrl}p/${mediaNodeInfo.code}/?taken-by=${userDB.userName}&__a=1`;
            r.get(videoJsonUrl, function (err, resp) {
                if (err) {
                    let theErr = `  ${userDB.userName}  get media id  ${mediaNodeInfo.id}  info fail.`;
                    userDB.logF.error(theErr);
                    callback2(theErr);
                    return false;
                }

                let videoJson = JSON.parse(resp.body);
                mediaNodeInfo.mediaSrc = videoJson.graphql.shortcode_media.video_url;
                downTheMedia(mediaNodeInfo, userDB, callback2);
            });
        } else {
            mediaNodeInfo.mediaSrc = mediaNodeInfo.display_src;
            downTheMedia(mediaNodeInfo, userDB, callback2);
        }
    }, function (err, result) {
        let count = {
            existedVideo: 0,
            downVideo: 0,
            existedImg: 0,
            downImg: 0,
            dealMedia: 0,
            countMedia: userDB.media.count,
            userName: userDB.userName
        };
        result.forEach(function (value) {
            if (value.video) {
                if (value.existed) {
                    count.existedVideo += 1;
                } else if (value.down) {
                    count.downVideo += 1;
                }
            } else if (value.img) {
                if (value.existed) {
                    count.existedImg += 1;
                } else if (value.down) {
                    count.downImg += 1;
                }
            }
        });
        count.dealMedia = count.existedVideo + count.downVideo + count.existedImg + count.downImg;


        userDB.logF.info(`  ${userDB.userName}  down    img  ${count.downImg}  video  ${count.downVideo}`);
        userDB.logF.info(`  ${userDB.userName}  existed img  ${count.existedImg}  video  ${count.existedVideo}`);
        userDB.logF.info(`  ${userDB.userName}  deal with media  ${count.dealMedia}/${count.countMedia}\n\n\n`);

        if (err) {
            callback(err, count);
        } else {
            callback(null, count);
        }
    });
}

function downTheMedia(mediaNodeInfo, userDB, callback2) {
    let nodeDate = new Date(mediaNodeInfo.date * 1000).Format('yyyy-MM-dd HH.mm.ss');
    // let nodeName = fileNameDelIllegalChar(mediaNodeInfo.caption) || 'null';
    let nodeExt = '.' + /^.*\.([\w\d]+)$/.exec(mediaNodeInfo.mediaSrc)[1];
    let savePath = path.join(userDB.savePath, nodeDate + ' ' + nodeExt);

    if (!fs.existsSync(savePath)) {
        let readStream = r.get(mediaNodeInfo.mediaSrc);

        let writeStream = fs.createWriteStream(savePath)
            .on('close', function () {
                userDB.logF.debug(`  ${userDB.userName}  down  ${savePath}  successful.`);
                callback2(null, {
                    existed: false,
                    down: true,
                    video: mediaNodeInfo.is_video,
                    img: !mediaNodeInfo.is_video
                });
            });

        readStream.pipe(writeStream)
            .on('error', function (err) {
                let theErr;
                if (fs.existsSync(savePath)) {
                    fs.unlinkSync(savePath);
                    theErr = `  ${userDB.userName}  down  ${savePath}  fail: connection interrupted.\n ${err}`;
                } else {
                    theErr = `  ${userDB.userName}  down  ${savePath}  fail: not down.\n ${err}`;
                }
                userDB.logF.error(theErr);
                callback2(theErr);
                return false;
            });
    } else {
        userDB.logF.debug(`  ${userDB.userName}  the  ${savePath}  exist locally.`);
        callback2(null, {
            existed: true,
            down: false,
            video: mediaNodeInfo.is_video,
            img: !mediaNodeInfo.is_video
        });
    }
}

init();