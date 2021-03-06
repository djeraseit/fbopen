/*jshint expr: true*/
var request = require('supertest'),
    chai = require('chai'),
    expect = require('chai').expect,
    tv4 = require('tv4'),
    async = require('async'),
    path = require('path'),
    child_process = require('child_process'),
    util = require('util'),
    elasticsearch = require('elasticsearch'),
    v0 = require('../v0.js'),
    v1 = require('../v1.js');

describe("The FBOpen API", function() {
  var app;
  var client;
  var index_name;
  chai.use(require('chai-things'));

  before(function(done) {
    this.timeout(10000);
    index_name = 'fbopen_api_test';

    process.env.ELASTICSEARCH_NOW = '2014-04-05';
    process.env.ELASTICSEARCH_INDEX = index_name;
    process.env.ELASTICSEARCH_HOST = 'localhost';

    app = require('../app.js');

    client = new elasticsearch.Client({
      host: 'localhost:9200',
      log: 'error'
    });
    async.series([
      function (callback) {
         client.indices.create({index: index_name, body: {
          "settings": { "index": { "analysis": { "analyzer": { "default": { "type": "snowball" }, "keyword-analyzer":{"tokenizer": "keyword", "filter":"lowercase" } } } } }
        }}, callback);
      }, function (callback) {
        client.indices.putMapping({index: index_name, type: 'opp', body: { "opp": { "properties": { "solnbr": {"analyzer": "keyword-analyzer", "type": "string"}} } }}, callback);
      }, function (callback) {
        client.indices.putMapping({index: index_name, type: 'opp_attachment', body: {
          "opp_attachment" : {
            "_parent": { "type": "opp" },
            "_source": { "excludes": [ "content" ] },
            "properties": {
              "content": {
                "type": "attachment",
                "fields": {
                  "content": { "store": "no" },
                  "author": { "store": "no" },
                  "title": { "store": "no", "analyzer": "english" },
                  "date": { "store": "no" },
                  "keywords": { "store": "no", "analyzer": "keyword" },
                  "_name": { "store": "no" },
                  "_content_type": { "store": "no" }
                }
              }
            }
          }
        }}, callback);
      }, function (callback) {
        child_cmd = 'elasticdump --input ' + path.resolve(path.join(__dirname, '/data/test_data.json')) + ' --output=http://localhost:9200/'+index_name+' --limit=50';
        // NOTE: if you have trouble with the test loading data properly, run the elasticdump command separately.
        // Make sure elasticdump says it has WRITTEN the objects.
        console.log("    Loading data with command: " + child_cmd);
        child_process.exec(child_cmd, callback);
      }, function(callback) {
        // wait for indexing
        setTimeout(callback, 3000);
      }], function (err, resp) {
        //console.log(resp);
        if (err) console.log(err);
        done();
      }
    );
  });

  var num_found = function(num) {
    return function(resp) {
      expect(resp.body).to.have.property('numFound', num);
    };
  };

  var num_returned = function(num) {
    return function(resp) {
      expect(resp.body.docs).to.have.length(num);
    };
  };

  var record_with_field = function(field, index, value) {
    return function(resp) {
      if (resp.body.docs) {
        // in case of multiple returned docs
        expect(resp.body.docs[index]).to.have.property(field, value);
      } else if (resp.body._source) {
        // in case of single returned doc
        expect(resp.body._source).to.have.property(field, value);
      }
    };
  };

  describe('Version 0', function() {
    it('should have a valid v0 schema', function(done){
      request(app)
        .get('/v0/opps?q=software')
        .expect(200)
        .expect(function(resp) {
          validation = tv4.validateMultiple(resp.body, v0, true, true);
          expect(validation.errors).to.have.length(0, util.inspect(validation.errors));
        })
        .end(done);
    });
    it('should have 409 total opp records in the test index (including closed and sole source)', function(done) {
      request(app)
        .get('/v0/opps?show_noncompeted=1&show_closed=1')
        .expect(200)
        .expect('Content-Type', /json/)
        .expect(num_found(409))
        .end(done);
    });

    it('should return all competed, open opps (default filter set)', function(done) {
      request(app)
        .get('/v0/opps')
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(num_found(359))
        .end(done);
    });

    it('should return only open opps (including non-competed)', function(done) {
      request(app)
        .get('/v0/opps?show_noncompeted=1')
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(num_found(377))
        .end(done);
    });

    it('should return all competed, open opps', function(done) {
      request(app)
        .get('/v0/opps?show_noncompeted=0')
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(num_found(359))
        .end(done);
    });

    it('should return all competed opps, whether open or closed', function(done) {
      request(app)
        .get('/v0/opps?show_closed=1')
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(num_found(389))
        .end(done);
    });

    it('should return all competed, open opps', function(done) {
      request(app)
        .get('/v0/opps?show_closed=0')
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(num_found(359))
        .end(done);
    });

    it('should return **all** opps', function(done) {
      request(app)
        .get('/v0/opps?show_closed=1&show_noncompeted=1')
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(num_found(409))
        .end(done);
    });

    it('should return competed, open opps about "computer"', function(done) {
      request(app)
        .get('/v0/opps?q=computer')
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(num_found(13))
        .expect(/computer/)
        .end(done);
    });

    it('should return competed, open opps, filtered to "air force"', function(done) {
      request(app)
        .get('/v0/opps?fq="air%20force"')
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(num_found(18))
        .expect(/air force/i)
        .end(done);
    });

    it('should return competed, open opps, filtered to "air force" and about "safety"', function(done) {
      request(app)
        .get('/v0/opps?fq="air%20force"&q="safety"')
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(num_found(1))
        .expect(/air force/i)
        .expect(/safety/i)
        .end(done);
    });

    //TODO: we need data from more sources, or to mark some test data as being from other sources, to properly test this
    it('should return results from FBO', function(done) {
      request(app)
        .get('/v0/opps?data_source=fbo.gov&show_noncompeted=1&show_closed=1')
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(num_found(186))
        .end(done);
    });

    it('should return results from FBO, case insensitively', function(done) {
      request(app)
        .get('/v0/opps?data_source=FBO.gov&show_noncompeted=1&show_closed=1')
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(num_found(186))
        .end(done);
    });

    it('should not return any results for missing dataset', function(done) {
      request(app)
        .get('/v0/opps?data_source=foobar&show_noncompeted=1&show_closed=1')
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(num_found(0))
        .end(done);
    });

    it('should allow limiting results', function(done) {
      request(app)
        .get('/v0/opps?limit=2')
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(num_found(359))
        .expect(num_returned(2))
        // that this record has moved to the front will be confirmed in the test
        // "should allow paging results"
        .expect(record_with_field('solnbr', 1, 'DHS-14-MT-041-000-01'))
        .end(done);
    });

    it('should allow paging results with start/limit', function(done) {
      request(app)
        .get('/v0/opps?start=1&limit=2')
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(num_found(359))
        .expect(num_returned(2))
        .expect(record_with_field('solnbr', 0, 'DHS-14-MT-041-000-01'))
        .end(done);
    });

    it('should allow paging results with p', function(done) {
      request(app)
        .get('/v0/opps?p=2&limit=1')
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(num_found(359))
        .expect(num_returned(1))
        .expect(record_with_field('solnbr', 0, 'DHS-14-MT-041-000-01'))
        .end(done);
    });

    it('should accept a whitelist of fields to return', function(done) {
      request(app)
        .get('/v0/opps?fl=solnbr,close_dt')
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(num_found(359))
        .expect(record_with_field('solnbr', 0, 'ag-0355-s-14-0006'))
        .expect(function(resp) {
          expect(resp.body.docs).to.not.have.property('agency');
          expect(resp.body.docs).to.not.have.property('description');
          expect(resp.body.docs).to.not.have.property('contact');
        })
        .end(done);
    });
    it('should order results such that first result matches solicitation number exactly when filtering to solnbr', function(done) {
      request(app)
        .get('/v0/opps?q=fa8571-14-r-0008')
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(num_found(137))
        .expect(record_with_field('solnbr', 0, 'fa8571-14-r-0008'))
        .end(done);
    });
    it('should not allow users to return a single record by id', function(done) {
      request(app)
        .get('/v0/opp/fbo.gov:COMBINE:fa8571-14-r-0008')
        .expect(404)
        .end(done);
    });
    it('should have results for bids.state.gov data', function(done){
      request(app)
        .get('/v0/opps?data_source=bids.state.gov')
        .expect(200)
        .expect(num_found(24))
        .end(done);
    });
    it('should have `score` but not `_score`', function(done){
      request(app)
        .get('/v0/opps?q=procure')
        .expect(200)
        .expect(function(resp) { expect(resp.body).to.have.property('docs'); })
        .expect(function(resp) { expect(resp.body.docs).to.all.not.have.property('_score'); })
        .expect(function(resp) { expect(resp.body.docs).to.all.have.property('score'); })
        .end(function(err, resp) {
          if (err) {
            done(err);
          } else {
            // console.log(util.inspect(resp.body.docs[0])); // for debugging, with failing asserts commented out above
            done();
          }
        });
    });
    it('should have `data_type` but not `_type`', function(done){
      request(app)
        .get('/v0/opps?q=procure')
        .expect(200)
        .expect(function(resp) { expect(resp.body.docs).to.all.not.have.property('_type'); })
        .expect(function(resp) { expect(resp.body.docs).to.all.have.property('data_type'); })
        .end(function(err, resp) {
          if (err) {
            done(err);
          } else {
            // console.log(util.inspect(resp.body.docs[0])); // for debugging, with failing asserts commented out above
            done();
          }
        });
    });
  });

  describe('version 1', function() {
    it('should have a valid v1 schema', function(done){
      request(app)
        .get('/v1/opps?q=software')
        .expect(200)
        .expect(function(resp) {
          validation = tv4.validateMultiple(resp.body, v1, true, true);
          expect(validation.errors).to.have.length(0, util.inspect(validation.errors));
        })
        .end(done);
    });
    it('should have 409 total opp records in the test index (including closed and sole source)', function(done) {
      request(app)
        .get('/v1/opps?show_noncompeted=1&show_closed=1')
        .expect(200)
        .expect('Content-Type', /json/)
        .expect(num_found(409))
        .end(done);
    });

    it('should return all competed, open opps (default filter set)', function(done) {
      request(app)
        .get('/v1/opps')
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(num_found(359))
        .end(done);
    });

    it('should return only open opps (including non-competed)', function(done) {
      request(app)
        .get('/v1/opps?show_noncompeted=1')
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(num_found(377))
        .end(done);
    });

    it('should return all competed, open opps', function(done) {
      request(app)
        .get('/v1/opps?show_noncompeted=0')
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(num_found(359))
        .end(done);
    });

    it('should return all competed opps, whether open or closed', function(done) {
      request(app)
        .get('/v1/opps?show_closed=1')
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(num_found(389))
        .end(done);
    });

    it('should return all competed, open opps', function(done) {
      request(app)
        .get('/v1/opps?show_closed=0')
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(num_found(359))
        .end(done);
    });

    it('should return **all** opps', function(done) {
      request(app)
        .get('/v1/opps?show_closed=1&show_noncompeted=1')
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(num_found(409))
        .end(done);
    });

    it('should return competed, open opps about "computer"', function(done) {
      request(app)
        .get('/v1/opps?q=computer')
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(num_found(13))
        .expect(/computer/)
        .end(done);
    });

    it('should return competed, open opps, filtered to "air force"', function(done) {
      request(app)
        .get('/v1/opps?fq="air%20force"')
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(num_found(18))
        .expect(/air force/i)
        .end(done);
    });

    it('should return competed, open opps, filtered to "air force" and about "safety"', function(done) {
      request(app)
        .get('/v1/opps?fq="air%20force"&q="safety"')
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(num_found(1))
        .expect(/air force/i)
        .expect(/safety/i)
        .end(done);
    });

    //TODO: we need data from more sources, or to mark some test data as being from other sources, to properly test this
    it('should return results from FBO', function(done) {
      request(app)
        .get('/v1/opps?data_source=fbo.gov&show_noncompeted=1&show_closed=1')
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(num_found(186))
        .end(done);
    });

    it('should return results from FBO, case insensitively', function(done) {
      request(app)
        .get('/v1/opps?data_source=FBO.gov&show_noncompeted=1&show_closed=1')
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(num_found(186))
        .end(done);
    });

    it('should not return any results for missing dataset', function(done) {
      request(app)
        .get('/v1/opps?data_source=foobar&show_noncompeted=1&show_closed=1')
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(num_found(0))
        .end(done);
    });

    it('should allow limiting results', function(done) {
      request(app)
        .get('/v1/opps?limit=2')
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(num_found(359))
        .expect(num_returned(2))
        // that this record has moved to the front will be confirmed in the test
        // "should allow paging results"
        .expect(record_with_field('solnbr', 1, 'DHS-14-MT-041-000-01'))
        .end(done);
    });

    it('should allow paging results with start/limit', function(done) {
      request(app)
        .get('/v1/opps?start=1&limit=2')
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(num_found(359))
        .expect(num_returned(2))
        .expect(record_with_field('solnbr', 0, 'DHS-14-MT-041-000-01'))
        .end(done);
    });

    it('should allow paging results with p', function(done) {
      request(app)
        .get('/v1/opps?p=2&limit=1')
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(num_found(359))
        .expect(num_returned(1))
        .expect(record_with_field('solnbr', 0, 'DHS-14-MT-041-000-01'))
        .end(done);
    });

    it('should accept a whitelist of fields to return', function(done) {
      request(app)
        .get('/v1/opps?fl=solnbr,close_dt')
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(num_found(359))
        .expect(record_with_field('solnbr', 0, 'ag-0355-s-14-0006'))
        .end(done);
    });
    it('should order results such that first result matches solicitation number exactly when filtering to solnbr', function(done) {
      request(app)
        .get('/v1/opps?q=fa8571-14-r-0008')
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(num_found(137))
        .expect(record_with_field('solnbr', 0, 'fa8571-14-r-0008'))
        .end(done);
    });
    it('should allow users to return a single record by id', function(done) {
      request(app)
        .get('/v1/opp/fbo.gov:COMBINE:fa8571-14-r-0008')
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(record_with_field('solnbr', 0, 'fa8571-14-r-0008'))
        .end(done);
    });
    it('should have results for bids.state.gov data', function(done){
      request(app)
        .get('/v1/opps?data_source=bids.state.gov')
        .expect(200)
        .expect(num_found(24))
        .end(done);
    });
    it('should have `_score` but not `score`', function(done){
      request(app)
        .get('/v1/opps?q=procure')
        .expect(200)
        .expect(function(resp) { expect(resp.body).to.have.property('docs'); })
        .expect(function(resp) { expect(resp.body.docs).to.all.not.have.property('score'); })
        .expect(function(resp) { expect(resp.body.docs).to.all.have.property('_score'); })
        .end(function(err, resp) {
          if (err) {
            done(err);
          } else {
            // console.log(util.inspect(resp.body.docs[0])); // for debugging, with failing asserts commented out above
            done();
          }
        });
    });
    it('should have `_type` but not `data_type`', function(done){
      request(app)
        .get('/v1/opps?q=procure')
        .expect(200)
        .expect(function(resp) { expect(resp.body.docs).to.all.not.have.property('data_type'); })
        .expect(function(resp) { expect(resp.body.docs).to.all.have.property('_type'); })
        .end(function(err, resp) {
          if (err) {
            done(err);
          } else {
            // console.log(util.inspect(resp.body.docs[0])); // for debugging, with failing asserts commented out above
            done();
          }
        });
    });
  });
  after(function(done) {
    async.series([
        function (callback) {
          client.indices.delete({index: index_name}, callback);
        }], function (err, resp) {
          //console.log(resp);
          if (err) console.log(err);
        done();
      }
    );
  });
});
