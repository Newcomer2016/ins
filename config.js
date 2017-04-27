let config = {
    // 部分ins用户设置需关注后才可获取, 可配置用户cookie 键为"sessionid"
    sessionCookie: '',

    // 抓取用户列表
    downUsers: [],

    savePath: './downloads',
    debug: false,

    maxUserOccurs: 1,
    maxMediaOccurs: 5,
    timeout: 20000,
    proxy: '',
    igrCAErr: false
};

module.exports = config;
