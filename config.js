let config = {
    // 部分ins用户设置需关注后才可获取, 可配置用户cookie 键为"sessionid"
    sessionCookie: '',

    // 抓取用户列表
    downUsers: [],

    savePath: './downloads',
    debug: false,

    maxUserOccurs: 3,
    maxMediaOccurs: 24,
    timeout: 10000,
    proxy: 'htyp://127.0.0.1:1080',
    igrCAErr: false
};

module.exports = config;