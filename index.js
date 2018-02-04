let process = require('process');
let path = require('path');
let fs = require('fs');

let async = require('async');
let request = require('request');
let cheerio = require('cheerio');

let config;
if (fs.existsSync('./config.my.js')) {
    config = require('./config.my');
} else if (fs.existsSync('./config.js')) {
    config = require('./config');
} else {
    console.log('Not find config.js');
    throw new Error('Not find config.js');
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

let oneLineFlag = false,
    oneLineLen = 0;

function logger(text, oneLine) {
    if (oneLine === true) {
        if (!oneLineFlag) {
            process.stdout.write('\n');
            oneLineFlag = true;
        } else {
            process.stdout.write('\r');
            process.stdout.write(new Array(oneLineLen + 1).join(' '));
            process.stdout.write('\r');
        }
        oneLineLen = text.replace(/[^\x00-\xff]/g, '01').length;
    } else if (oneLine === false || oneLine === undefined) {
        process.stdout.write('\n');
        oneLineFlag = false;
        oneLineLen = 0;
    } else {
        throw new Error('oneLine not ( true | false | undefined)');
    }
    process.stdout.write(text);
}

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


const hostUrl = 'https://www.instagram.com';
const defUserOccurs = 1;
config.maxUserOccurs = config.maxUserOccurs || defUserOccurs;
const defMediaOccurs = 8;
config.maxMediaOccurs = config.maxMediaOccurs || defMediaOccurs;
const defTimeout = 10000;

const allSavePath = config.savePath || './';


function init() {
    let downUsers;

    if (process.argv.length > 2) {
        downUsers = process.argv.slice(2);
    } else {
        downUsers = config.downUsers;
    }

    if (config.userFollow) {
        r.get(hostUrl + '/' + config.userFollow + '/', function (err, resp) {
            let $ = cheerio.load(resp.body);
            $('script').each(function (index, element) {
                if ($(element).text() && /^window\._sharedData = (\{.*\});$/.test($(element).text())) {
                    let onePageNodes = 10000,
                        query_hash = '58712303d941c6855d4e888c5f0cd22f',
                        variables = {
                            id: JSON.parse(RegExp.$1).entry_data.ProfilePage[0].user.id,
                            first: onePageNodes
                        };

                    r.get({
                        url: `${hostUrl}/graphql/query/`,
                        qs: {
                            query_hash: query_hash,
                            variables: JSON.stringify(variables)
                        }
                    }, function (err, resp) {
                        JSON.parse(resp.body).data.user.edge_follow.edges.forEach((edge) => {
                            if (!downUsers.includes(edge.node.username)) {
                                downUsers.push(edge.node.username);
                            }
                        });

                        startDown(downUsers);
                    });
                }
            });
        });
    } else {
        startDown(downUsers);
    }
}

function startDown(downUsers) {
    if (!downUsers || downUsers.length === 0) {
        logger('not find any users.');
        return false;
    }

    logger(`down users is ( ${downUsers.join(' | ')} )`);
    creatSavePath(allSavePath);

    async.mapLimit(downUsers, config.maxUserOccurs, function (downUser, callback) {
        getDownUserInfo(downUser, callback);
    }, function (err, result) {
        if (err) {
            logger('\nsome bad error:');
            logger(err);
        } else {
            logger(`***   ${result.length} users end the task   ***\n`);
            let downMediaCount = 0;
            result.forEach(function (userDB) {
                logger(`  ${userDB.userName}  down     ${userDB.downs}  media`);
                logger(`  ${userDB.userName}  existed  ${userDB.exists}  media`);
                logger(`  ${userDB.userName}  miss  ${userDB.miss}  media`);
                logger(`  ${userDB.userName}  deal with media  ${userDB.exists + userDB.downs}/${userDB.mediaCount}(${userDB.media.count})\n`);

                downMediaCount += userDB.downs;
            });
            logger(`***   ${result.length} users have down  ${downMediaCount}  media   ***`);
        }
    });
}

function getDownUserInfo(downUser, callback) {
    let userDB = {
        userName: downUser,
        id: undefined,
        // csrfToken: undefined,
        savePath: undefined,
        nodeListFile: undefined,
        localNodes: {
            len: 0
        },
        localSidecars: {
            len: 0
        },
        getSidecars: [],
        media: {
            nodes: [],
            count: 0,
            page_info: {
                has_next_page: false,
                end_cursor: undefined
            }
        },
        mediaCount: 0,
        downs: 0,
        exists: 0,
        miss: 0
    };

    let rGetDownUserInfoTimes = 0;
    (function rGetDownUserInfo() {
        r.get(hostUrl + '/' + downUser + '/', function (err, resp) {
            if (err) {
                rGetDownUserInfoTimes++;
                if (rGetDownUserInfoTimes < rMaxTimes) {
                    logger(`  ${userDB.userName}  get user info retry ${rGetDownUserInfoTimes}`);
                    rGetDownUserInfo();
                    return;
                } else {
                    let theErr = `  ${userDB.userName}  get user info fail  ${resp.statusCode}`;
                    logger(theErr);
                    callback(theErr);
                    return false;
                }
            }

            if (resp.statusCode !== 200) {
                logger(`  ${userDB.userName} user not find  ${resp.statusCode}`);
                callback(null, userDB);
                return false;
            }

            let $ = cheerio.load(resp.body);
            $('script').each(function (index, element) {
                if ($(element).text() && /^window\._sharedData = (\{.*\});$/.test($(element).text())) {
                    let downUserInfo = JSON.parse(RegExp.$1);
                    if (downUserInfo.entry_data.ProfilePage) {
                        userDB.id = downUserInfo.entry_data.ProfilePage[0].user.id;
                        // userDB.userName = downUserInfo.entry_data.ProfilePage[0].user.username;
                        userDB.media = downUserInfo.entry_data.ProfilePage[0].user.media;
                        // userDB.media.nodes = [];

                        userDB.savePath = path.join(allSavePath, userDB.id + ' - ' + userDB.userName);
                    }
                }
            });

            if (!userDB.id) {
                logger(`  ${userDB.userName}  the resp.body not have user info`);
                callback(null, userDB);
                return false;
            }

            if (userDB.media.nodes.length === 0) {
                logger(`  ${userDB.userName}  the user no media or need login`);
                callback(null, userDB);
                return false;
            }


            fs.readdirSync(allSavePath).forEach(function (fileName /* , index, array */ ) {
                if (new RegExp(`^${userDB.id} - .*$`).test(fileName)) {
                    if (fileName !== userDB.id + ' - ' + userDB.userName) {
                        fs.renameSync(path.join(allSavePath, fileName), userDB.savePath);
                    }
                }
            });

            if (!creatSavePath(userDB.savePath)) {
                let theErr = `creat ${userDB.savePath} path fail`;
                logger(theErr);
                callback(theErr);
                return false;
            }

            userDB.nodeListFile = path.join(userDB.savePath, '!nodeList.json');

            if (fs.existsSync(userDB.nodeListFile)) {
                let localData = JSON.parse(fs.readFileSync(userDB.nodeListFile, 'utf8'));
                userDB.localNodes = localData.localNodes;
                userDB.localSidecars = localData.localSidecars;
            }

            logger(`  ${userDB.userName}  ${userDB.id}  get user info success`);
            getMediaNodeList(userDB, callback);
        });
    })();
}


function getMediaNodeList(userDB, callback) {
    let lastID = userDB.media.nodes.slice(-1)[0].id;
    if (userDB.media.page_info.has_next_page &&
        userDB.localNodes[lastID] === undefined &&
        userDB.localSidecars[lastID] === undefined
    ) {
        let onePageNodes = 12,
            query_hash = '472f257a40c653c64c666ce877d59d2b',
            variables = {
                id: userDB.id,
                first: onePageNodes,
                after: userDB.media.page_info.end_cursor
            };

        let rGetMediaNodeListTimes = 0;
        (function rGetMediaNodeList() {
            r.get({
                url: `${hostUrl}/graphql/query/`,
                qs: {
                    query_hash: query_hash,
                    variables: JSON.stringify(variables)
                },
                headers: {
                    'Accept': '*/*',
                    // 'X-CSRFToken': userDB.csrfToken,
                    'Referer': hostUrl + '/' + userDB.userName + '/',
                }
            }, function (err, resp) {
                let nextData,
                    jsonError = false;

                try {
                    nextData = JSON.parse(resp.body);
                } catch (error) {
                    jsonError = true;
                }

                if (err || resp.statusCode !== 200 || jsonError || nextData.status !== 'ok') {
                    rGetMediaNodeListTimes++;
                    if (rGetMediaNodeListTimes < rMaxTimes) {
                        logger(`  ${userDB.userName}  get media list retry ${rGetMediaNodeListTimes}`);
                        rGetMediaNodeList();
                        return;
                    } else {
                        let theErr = `  ${userDB.userName}  get media list fail  ${resp.statusCode}`;
                        logger(theErr);
                        logger('  2 min retry');
                        setTimeout(rGetMediaNodeList, 2 * 60 * 1000);
                        // callback(theErr);
                        return false;
                    }
                }

                nextData.data.user.edge_owner_to_timeline_media.edges.forEach((value) => {
                    userDB.media.nodes.push(value.node);
                });
                userDB.media.page_info = nextData.data.user.edge_owner_to_timeline_media.page_info;

                logger(`  ${userDB.userName}  get media list node:${userDB.media.nodes.length}/${userDB.media.count} success`, true);

                setTimeout(() => {
                    getMediaNodeList(userDB, callback);
                }, 200);
            });
        })();
    } else {
        userDB.media.nodes.forEach((node) => {
            if (userDB.localNodes[node.id] === undefined && userDB.localSidecars[node.id] === undefined) {
                if (node.__typename === 'GraphSidecar') {
                    userDB.getSidecars.push(node);
                } else {
                    let mediaNode = {
                        __typename: node.__typename,
                        is_video: node.is_video,
                        id: node.id,
                        code: node.code || node.shortcode,
                        date: node.date || node.taken_at_timestamp,
                        display_src: node.display_src || node.display_url
                    };
                    mediaNode.mediaName = new Date(mediaNode.date * 1000).Format('yyyy.MM.dd - HH.mm.ss') + ' - ' + mediaNode.id;

                    userDB.localNodes[mediaNode.id] = mediaNode;
                    userDB.localNodes.len++;
                }
            }
        });

        userDB.media.nodes = [];

        logger(`  ${userDB.userName}  get media list (media:${userDB.localNodes.len} + sidecar:${userDB.localSidecars.len + userDB.getSidecars.length})/${userDB.media.count} success`);
        readAndExistsFiles(userDB, callback);
    }
}

function readAndExistsFiles(userDB, callback) {
    async.mapLimit(userDB.getSidecars, config.maxMediaOccurs, function (node, callback2) {
        let sidecarNode = {
            __typename: node.__typename,
            is_video: node.is_video,
            id: node.id,
            code: node.code || node.shortcode,
            date: node.date || node.taken_at_timestamp,
            display_src: node.display_src || node.display_url,
            childNodeID: []
        };

        let rGetSidecarTimes = 0;
        (function rGetSidecar() {
            let sidecarUrl = `${hostUrl}/p/${sidecarNode.code}/?__a=1`;
            r.get(sidecarUrl, function (err, resp) {
                if (err || resp.statusCode !== 200) {
                    rGetSidecarTimes++;
                    if (rGetSidecarTimes < rMaxTimes) {
                        logger(`  ${userDB.userName}  get Sidecar ${sidecarNode.code} info retry ${rGetSidecarTimes}`);
                        rGetSidecar();
                        return;
                    } else {
                        let theErr = `  ${userDB.userName}  get Sidecar ${sidecarNode.code} info fail  ${resp.statusCode}`;
                        logger(theErr);
                        callback2(theErr);
                        return false;
                    }
                }

                let sidecarJson = JSON.parse(resp.body),
                    childNodes = [];

                sidecarJson.graphql.shortcode_media.edge_sidecar_to_children.edges.forEach((value) => {
                    value.node.date = sidecarNode.date;
                    childNodes.push(value.node);

                    sidecarNode.childNodeID.push(value.node.id);
                });

                userDB.localSidecars[sidecarNode.id] = sidecarNode;
                userDB.localSidecars.len++;

                callback2(null, childNodes);
            });
        })();
    }, function (err, result) {
        if (err) {
            callback(err);
            return false;
        }

        result.forEach((nodes) => {
            nodes.forEach((node) => {
                let mediaNode = {
                    __typename: node.__typename,
                    is_video: node.is_video,
                    id: node.id,
                    code: node.code || node.shortcode,
                    date: node.date || node.taken_at_timestamp,
                    display_src: node.display_src || node.display_url
                };
                mediaNode.mediaName = new Date(mediaNode.date * 1000).Format('yyyy.MM.dd - HH.mm.ss') + ' - ' + mediaNode.id;

                if (userDB.localNodes[mediaNode.id] === undefined) {
                    userDB.localNodes[mediaNode.id] = mediaNode;
                    userDB.localNodes.len++;
                }
            });
        });

        fs.writeFileSync(userDB.nodeListFile, JSON.stringify({
            localNodes: userDB.localNodes,
            localSidecars: userDB.localSidecars
        }, null, 4), 'utf8');

        for (let nodeID in userDB.localNodes) {
            if (nodeID !== 'len') {
                userDB.media.nodes.push(userDB.localNodes[nodeID]);
            }
        }

        userDB.media.nodes.sort((a, b) => {
            if (a.date < b.date) {
                return -1;
            } else {
                return 1;
            }
        });

        userDB.mediaCount = userDB.media.nodes.length;
        logger(`  ${userDB.userName}  get all media info (media:${userDB.mediaCount} + sidecar:${userDB.localSidecars.len})/${userDB.media.count} success`);


        fs.readdirSync(userDB.savePath).forEach(function (fileName /* , index, array */ ) {
            let fileStat = fs.statSync(path.join(userDB.savePath, fileName));
            if (fileStat.isFile()) {
                if (fileName.slice(-4) === '.tmp') {
                    fs.unlinkSync(path.join(userDB.savePath, fileName));
                } else {
                    for (let i = 0; i < userDB.media.nodes.length; i++) {
                        if (fileName.includes(userDB.media.nodes[i].mediaName)) {
                            userDB.exists++;
                            userDB.media.nodes.splice(i, 1);
                            i--;
                        }
                    }
                }
            }
        });

        logger(`  ${userDB.userName}  have ${userDB.exists}/${userDB.mediaCount}(${userDB.media.count}) media exist locally`);
        logger(`  ${userDB.userName}  media node downloading. Please wait ...`);
        downMediaList(userDB, callback);
    });
}

function downMediaList(userDB, callback) {
    let mediaNodeList = userDB.media.nodes;

    async.mapLimit(mediaNodeList, config.maxMediaOccurs, function (mediaNodeInfo, callback3) {
        if (mediaNodeInfo.is_video) {
            let rGetVideoInfoTimes = 0;
            (function rGetVideoInfo() {
                let videoJsonUrl = `${hostUrl}/p/${mediaNodeInfo.code}/?__a=1`;
                r.get(videoJsonUrl, function (err, resp) {
                    let mediaSrc = '',
                        jsonError = false;

                    if (resp.request.href === videoJsonUrl) {
                        try {
                            mediaSrc = JSON.parse(resp.body).graphql.shortcode_media.video_url;
                        } catch (error) {
                            jsonError = true;
                        }
                    } else {
                        try {
                            let $ = cheerio.load(resp.body);
                            $('script').each(function (index, element) {
                                if ($(element).text() && /^window\._sharedData = (\{.*\});$/.test($(element).text())) {
                                    let videoInfo = JSON.parse(RegExp.$1);
                                    videoInfo.entry_data.PostPage[0].graphql.shortcode_media.edge_sidecar_to_children.edges.forEach((edge) => {
                                        if (edge.node.id === mediaNodeInfo.id) {
                                            mediaSrc = edge.node.video_url;
                                        }
                                    });
                                }
                            });
                        } catch (error) {
                            jsonError = true;
                        }
                    }

                    if (err || resp.statusCode !== 200 || jsonError || !mediaSrc) {
                        rGetVideoInfoTimes++;
                        if (rGetVideoInfoTimes < rMaxTimes) {
                            logger(`  ${userDB.userName}  get video ${mediaNodeInfo.code} info retry ${rGetVideoInfoTimes}`);
                            rGetVideoInfo();
                            return;
                        } else {
                            userDB.miss++;
                            logger(`  ${userDB.userName}  get video ${mediaNodeInfo.code} info fail  ${resp.statusCode}`);
                            callback3(null, false);
                            return false;
                        }
                    }

                    downTheMedia(mediaSrc, mediaNodeInfo.mediaName, callback3);
                });
            })();
        } else {
            downTheMedia(mediaNodeInfo.display_src, mediaNodeInfo.mediaName, callback3);
        }

        function downTheMedia(mediaSrc, mediaName, callback3) {
            let mediaExt = mediaSrc.replace(/\?.*$/, '').replace(/^.*\./, '');
            let savePath = path.join(userDB.savePath, mediaName + '.' + mediaExt);

            let rDownTheMediaTimes = 0;
            (function rDownTheMedia() {
                if (fs.existsSync(savePath + '.tmp')) {
                    fs.unlinkSync(savePath + '.tmp');
                }

                r.get(mediaSrc)
                    .on('error', errHandle)
                    .pipe(fs.createWriteStream(savePath + '.tmp')
                        .on('close', function () {
                            fs.renameSync(savePath + '.tmp', savePath);
                            userDB.downs++;
                            logger(`  ${userDB.userName}  ${userDB.exists + userDB.downs}/${userDB.mediaCount}(${userDB.media.count})  down  ${mediaName}  success`, true);

                            callback3(null, true);
                        }))
                    .on('error', errHandle);

                function errHandle(err) {
                    rDownTheMediaTimes++;
                    if (rDownTheMediaTimes < rMaxTimes) {
                        logger(`  ${userDB.userName}  down ${mediaName} retry ${rDownTheMediaTimes}`);
                        rDownTheMedia();
                        return;
                    } else {
                        userDB.miss++;
                        logger(`  ${userDB.userName}  down ${mediaName} fail\n   err: ${err}`);
                        callback3(null, false);
                        return false;
                    }
                }
            })();
        }

    },
    function (err /* , result */ ) {
        logger('');
        logger(`  ${userDB.userName}  down     ${userDB.downs}  media`);
        logger(`  ${userDB.userName}  existed  ${userDB.exists}  media`);
        logger(`  ${userDB.userName}  miss     ${userDB.miss}  media`);
        logger(`  ${userDB.userName}  deal with media  ${userDB.exists + userDB.downs}/${userDB.mediaCount}(${userDB.media.count})\n`);

        if (err) {
            logger(`  ${userDB.userName}  have some err\n    ${err}\n`);
            callback(err);
        } else {
            callback(null, userDB);
        }
    });
}




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
    }),
    rMaxTimes = 3;

init();
